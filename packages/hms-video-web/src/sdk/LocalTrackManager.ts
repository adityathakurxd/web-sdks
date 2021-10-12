import { HMSAudioCodec, HMSVideoCodec, PublishParams } from '../interfaces';
import {
  HMSVideoTrackSettings,
  HMSVideoTrackSettingsBuilder,
  HMSAudioTrackSettings,
  HMSAudioTrackSettingsBuilder,
  HMSTrackSettingsBuilder,
  HMSTrackSettings,
} from '../media/settings';
import InitialSettings from '../interfaces/settings';
import { HMSLocalAudioTrack, HMSLocalVideoTrack, HMSTrackType } from '../media/tracks';
import { IStore } from './store';
import { IFetchAVTrackOptions } from '../transport/ITransport';
import HMSLogger from '../utils/logger';
import { HMSException } from '../error/HMSException';
import { ErrorFactory, HMSAction } from '../error/ErrorFactory';
import ITransportObserver from '../transport/ITransportObserver';
import HMSLocalStream from '../media/streams/HMSLocalStream';
import analyticsEventsService from '../analytics/AnalyticsEventsService';
import AnalyticsEventFactory from '../analytics/AnalyticsEventFactory';
import { DeviceManager } from '../device-manager';
import { BuildGetMediaError, HMSGetMediaActions } from '../error/utils';

export type HMSLocalTrack = HMSLocalAudioTrack | HMSLocalVideoTrack;

const defaultSettings = {
  isAudioMuted: false,
  isVideoMuted: false,
  audioInputDeviceId: 'default',
  audioOutputDeviceId: 'default',
  videoDeviceId: 'default',
};

let blankCanvas: any;

export class LocalTrackManager {
  readonly TAG: string = '[LocalTrackManager]';

  constructor(private store: IStore, private observer: ITransportObserver, private deviceManager: DeviceManager) {}

  async getTracksToPublish(initialSettings: InitialSettings): Promise<HMSLocalTrack[]> {
    const publishParams = this.store.getPublishParams();
    if (!publishParams) return [];

    const { allowed } = publishParams;
    const canPublishAudio = Boolean(allowed && allowed.includes('audio'));
    const canPublishVideo = Boolean(allowed && allowed.includes('video'));

    if (!canPublishAudio && !canPublishVideo) {
      return [];
    }
    let tracksToPublish: Array<HMSLocalTrack> = [];

    const trackSettings = this.getTrackSettings(initialSettings, publishParams);

    if (!trackSettings) {
      return [];
    }

    const localTracks = this.store.getLocalPeerTracks();
    const videoTrack = localTracks.find((t) => t.type === HMSTrackType.VIDEO && t.source === 'regular') as
      | HMSLocalVideoTrack
      | undefined;
    const audioTrack = localTracks.find((t) => t.type === HMSTrackType.AUDIO && t.source === 'regular') as
      | HMSLocalAudioTrack
      | undefined;

    // The track gets added to the store only after it is published.
    const isVideoTrackPublished = Boolean(videoTrack && this.store.getTrackById(videoTrack.trackId));
    const isAudioTrackPublished = Boolean(audioTrack && this.store.getTrackById(audioTrack.trackId));

    if (videoTrack && trackSettings.video) {
      await videoTrack.setSettings(trackSettings.video);
    }

    if (audioTrack && trackSettings.audio) {
      await audioTrack.setSettings(trackSettings.audio);
    }

    if (isVideoTrackPublished && isAudioTrackPublished) {
      // there is nothing to publish
      return [];
    }

    let fetchTrackOptions: IFetchAVTrackOptions = {
      audio: canPublishAudio && !audioTrack && (initialSettings.isAudioMuted ? 'empty' : true),
      video: canPublishVideo && !videoTrack && (initialSettings.isVideoMuted ? 'empty' : true),
    };
    try {
      HMSLogger.d(this.TAG, 'Init Local Tracks', { fetchTrackOptions });
      tracksToPublish = await this.getLocalTracks(fetchTrackOptions, trackSettings);
    } catch (error) {
      if (error instanceof HMSException && error.action === HMSAction.TRACK) {
        this.observer.onFailure(error);

        const audioFailure = error.message.includes('audio');
        const videoFailure = error.message.includes('video');
        fetchTrackOptions.audio = audioFailure ? 'empty' : fetchTrackOptions.audio;
        fetchTrackOptions.video = videoFailure ? 'empty' : fetchTrackOptions.video;
        HMSLogger.w(this.TAG, 'Fetch AV Tracks failed', { fetchTrackOptions }, error);
        try {
          tracksToPublish.push(...(await this.getLocalTracks(fetchTrackOptions, trackSettings)));
        } catch (error) {
          HMSLogger.w(this.TAG, 'Fetch empty tacks failed', error);
          fetchTrackOptions.audio = fetchTrackOptions.audio && 'empty';
          fetchTrackOptions.video = fetchTrackOptions.video && 'empty';
          tracksToPublish.push(...(await this.getLocalTracks(fetchTrackOptions, trackSettings)));
          this.observer.onFailure(ErrorFactory.TracksErrors.GenericTrack(HMSAction.TRACK, (error as Error).message));
        }
      } else {
        HMSLogger.w(this.TAG, 'Fetch AV Tracks failed - unknown exception', error);
        this.observer.onFailure(ErrorFactory.TracksErrors.GenericTrack(HMSAction.TRACK, (error as Error).message));
      }
    }

    /**
     * concat local tracks only if both are true which means it is either join or switched from a role
     * with no tracks earlier.
     * the reason we need this is for preview API to work, in case of preview we want to publish the same
     * tracks which were shown and are already part of the local peer instead of creating new ones.
     * */
    // if (publishConfig.publishAudio && publishConfig.publishVideo) {
    //   return tracks.concat(localTracks);
    // }
    if (videoTrack && canPublishVideo && !isVideoTrackPublished) {
      tracksToPublish.push(videoTrack);
    }
    if (audioTrack && canPublishAudio && !isAudioTrackPublished) {
      tracksToPublish.push(audioTrack);
    }
    return tracksToPublish;
  }

  async getLocalTracks(
    fetchTrackOptions: IFetchAVTrackOptions = { audio: true, video: true },
    settings: HMSTrackSettings,
  ): Promise<Array<HMSLocalTrack>> {
    try {
      const nativeTracks = await this.getNativeLocalTracks(fetchTrackOptions, settings);
      const nativeVideoTrack = nativeTracks.find((track) => track.kind === 'video');
      const nativeAudioTrack = nativeTracks.find((track) => track.kind === 'audio');
      const local = new HMSLocalStream(new MediaStream(nativeTracks));

      const tracks: Array<HMSLocalTrack> = [];
      if (nativeAudioTrack && settings?.audio) {
        const audioTrack = new HMSLocalAudioTrack(local, nativeAudioTrack, 'regular', settings.audio);
        tracks.push(audioTrack);
      }

      if (nativeVideoTrack && settings?.video) {
        const videoTrack = new HMSLocalVideoTrack(local, nativeVideoTrack, 'regular', settings.video);
        tracks.push(videoTrack);
      }
      return tracks;
    } catch (error) {
      // TOOD: On OverConstrained error, retry with dropping all constraints.
      // Just retry getusermedia again - it sometimes work when AbortError or NotFoundError is thrown on a few devices
      if (error instanceof HMSException) {
        analyticsEventsService
          .queue(
            AnalyticsEventFactory.publish({
              devices: this.deviceManager.getDevices(),
              error,
              settings,
            }),
          )
          .flush();
      }
      throw error;
    }
  }

  private async getNativeLocalTracks(
    fetchTrackOptions: IFetchAVTrackOptions = { audio: false, video: false },
    settings: HMSTrackSettings,
  ) {
    let trackSettings = new HMSTrackSettings(
      fetchTrackOptions.video === true ? settings.video : null,
      fetchTrackOptions.audio === true ? settings.audio : null,
      settings.simulcast,
    );

    let nativeTracks: MediaStreamTrack[] = [];

    if (trackSettings.audio || trackSettings.video) {
      nativeTracks.push(...(await this.getAVTracks(trackSettings)));
    }

    if (fetchTrackOptions.audio === 'empty') {
      nativeTracks.push(this.getEmptyAudioTrack());
    }

    if (fetchTrackOptions.video === 'empty') {
      nativeTracks.push(this.getEmptyVideoTrack());
    }

    return nativeTracks;
  }

  private getEmptyVideoTrack(prevTrack?: MediaStreamTrack): MediaStreamTrack {
    const width = prevTrack?.getSettings()?.width || 320;
    const height = prevTrack?.getSettings()?.height || 240;
    const frameRate = 10; // fps TODO: experiment, see if this can be reduced
    if (!blankCanvas) {
      blankCanvas = Object.assign(document.createElement('canvas'), { width, height });
      blankCanvas.getContext('2d')?.fillRect(0, 0, width, height);
    }
    const stream = blankCanvas.captureStream(frameRate);
    const emptyTrack = stream.getVideoTracks()[0];
    const intervalID = setInterval(() => {
      if (emptyTrack.readyState === 'ended') {
        clearInterval(intervalID);
        return;
      }
      const ctx = blankCanvas.getContext('2d');
      if (ctx) {
        const pixel = ctx.getImageData(0, 0, 1, 1).data;
        const red = pixel[0] === 0 ? 1 : 0; // toggle red in pixel
        ctx.fillStyle = `rgb(${red}, 0, 0)`;
        ctx.fillRect(0, 0, 1, 1);
      }
    }, 1000 / frameRate);
    emptyTrack.onended = () => {
      clearInterval(intervalID);
    };
    emptyTrack.enabled = false;
    return emptyTrack;
  }

  private getEmptyAudioTrack(): MediaStreamTrack {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const dst = oscillator.connect(ctx.createMediaStreamDestination());
    oscillator.start();
    // @ts-expect-error
    const emptyTrack = dst.stream.getAudioTracks()[0];
    emptyTrack.enabled = false;
    return emptyTrack;
  }

  private async getAVTracks(settings: HMSTrackSettings): Promise<Array<MediaStreamTrack>> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: settings.audio ? settings.audio.toConstraints() : false,
        video: settings.video ? settings.video.toConstraints() : false,
      });

      return stream.getVideoTracks().concat(stream.getAudioTracks());
    } catch (error) {
      let videoError = false;
      let audioError = false;

      await this.deviceManager.init();

      if (!this.deviceManager.hasWebcamPermission && settings.video) {
        videoError = true;
      }

      if (!this.deviceManager.hasMicrophonePermission && settings.audio) {
        audioError = true;
      }

      if (videoError && audioError) {
        throw BuildGetMediaError(error as Error, HMSGetMediaActions.AV);
      } else if (videoError) {
        throw BuildGetMediaError(error as Error, HMSGetMediaActions.VIDEO);
      } else {
        throw BuildGetMediaError(error as Error, HMSGetMediaActions.AUDIO);
      }
    }
  }

  private getTrackSettings(initialSettings: InitialSettings, publishParams: PublishParams): HMSTrackSettings | null {
    const { audio, video, allowed } = publishParams;
    const canPublishAudio = Boolean(allowed && allowed.includes('audio'));
    const canPublishVideo = Boolean(allowed && allowed.includes('video'));

    if (!canPublishAudio && !canPublishVideo) {
      return null;
    }
    const { audioInputDeviceId, videoDeviceId } = initialSettings;

    let audioSettings: HMSAudioTrackSettings | null = null;
    let videoSettings: HMSVideoTrackSettings | null = null;
    if (canPublishAudio) {
      audioSettings = new HMSAudioTrackSettingsBuilder()
        .codec(audio.codec as HMSAudioCodec)
        .maxBitrate(audio.bitRate)
        .deviceId(audioInputDeviceId || defaultSettings.audioInputDeviceId)
        .build();
    }
    if (canPublishVideo) {
      const dimensions = this.store.getSimulcastDimensions('regular');
      videoSettings = new HMSVideoTrackSettingsBuilder()
        .codec(video.codec as HMSVideoCodec)
        .maxBitrate(video.bitRate)
        .maxFramerate(video.frameRate)
        .setWidth(dimensions?.width || video.width) // take simulcast width if available
        .setHeight(dimensions?.height || video.height) // take simulcast width if available
        .deviceId(videoDeviceId || defaultSettings.videoDeviceId)
        .build();
    }

    return new HMSTrackSettingsBuilder().video(videoSettings).audio(audioSettings).build();
  }
}