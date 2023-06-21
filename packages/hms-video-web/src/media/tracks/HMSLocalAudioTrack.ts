import { HMSAudioTrack } from './HMSAudioTrack';
import { DeviceStorageManager } from '../../device-manager/DeviceStorage';
import { HMSException } from '../../error/HMSException';
import { EventBus } from '../../events/EventBus';
import { HMSAudioTrackSettings as IHMSAudioTrackSettings } from '../../interfaces';
import { HMSAudioPlugin, HMSPluginSupportResult } from '../../plugins';
import { HMSAudioPluginsManager } from '../../plugins/audio';
import HMSLogger from '../../utils/logger';
import { isBrowser, isIOS } from '../../utils/support';
import { getAudioTrack, isEmptyTrack } from '../../utils/track';
import { TrackAudioLevelMonitor } from '../../utils/track-audio-level-monitor';
import { HMSAudioTrackSettings, HMSAudioTrackSettingsBuilder } from '../settings';
import { HMSLocalStream } from '../streams';

function generateHasPropertyChanged(newSettings: Partial<HMSAudioTrackSettings>, oldSettings: HMSAudioTrackSettings) {
  return function hasChanged(prop: 'codec' | 'volume' | 'maxBitrate' | 'deviceId' | 'advanced') {
    return prop in newSettings && newSettings[prop] !== oldSettings[prop];
  };
}

export class HMSLocalAudioTrack extends HMSAudioTrack {
  private readonly TAG = '[HMSLocalAudioTrack]';
  settings: HMSAudioTrackSettings;
  private pluginsManager: HMSAudioPluginsManager;
  private processedTrack?: MediaStreamTrack;

  audioLevelMonitor?: TrackAudioLevelMonitor;

  /**
   * see the doc in HMSLocalVideoTrack
   * @internal
   */
  publishedTrackId?: string;

  /**
   * will be false for preview tracks
   */
  isPublished = false;

  constructor(
    stream: HMSLocalStream,
    track: MediaStreamTrack,
    source: string,
    private eventBus: EventBus,
    settings: HMSAudioTrackSettings = new HMSAudioTrackSettingsBuilder().build(),
  ) {
    super(stream, track, source);
    stream.tracks.push(this);

    this.settings = settings;
    // Replace the 'default' or invalid deviceId with the actual deviceId
    // This is to maintain consistency with selected devices as in some cases there will be no 'default' device
    if (settings.deviceId !== track.getSettings().deviceId && !isEmptyTrack(track)) {
      this.settings = this.buildNewSettings({ deviceId: track.getSettings().deviceId });
    }
    this.pluginsManager = new HMSAudioPluginsManager(this, eventBus);
    this.setFirstTrackId(track.id);
    if (isIOS() && isBrowser) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private handleVisibilityChange = async () => {
    if (document.visibilityState === 'visible') {
      await this.replaceTrackWith(this.settings);
    }
  };

  private async replaceTrackWith(settings: HMSAudioTrackSettings) {
    const prevTrack = this.nativeTrack;
    /*
     * Note: Do not change the order of this.
     * stop the previous before acquiring the new track otherwise this can lead to
     * no audio when the above getAudioTrack throws an error. ex: DeviceInUse error
     */
    prevTrack?.stop();
    const isLevelMonitored = Boolean(this.audioLevelMonitor);
    const newTrack = await getAudioTrack(settings);
    newTrack.enabled = this.enabled;
    HMSLogger.d(this.TAG, 'replaceTrack, Previous track stopped', prevTrack, 'newTrack', newTrack);

    const localStream = this.stream as HMSLocalStream;
    // change nativeTrack so plugin can start its work
    await localStream.replaceSenderTrack(prevTrack, this.processedTrack || newTrack);
    await localStream.replaceStreamTrack(prevTrack, newTrack);
    this.nativeTrack = newTrack;
    isLevelMonitored && this.initAudioLevelMonitor();
    try {
      await this.pluginsManager.reprocessPlugins();
    } catch (e) {
      this.eventBus.audioPluginFailed.publish(e as HMSException);
    }
  }

  async setEnabled(value: boolean) {
    if (value === this.enabled) {
      return;
    }

    // Replace silent empty track with an actual audio track, if enabled.
    if (value && isEmptyTrack(this.nativeTrack)) {
      await this.replaceTrackWith(this.settings);
    }
    await super.setEnabled(value);
    if (value) {
      this.settings = this.buildNewSettings({ deviceId: this.nativeTrack.getSettings().deviceId });
    }
    this.eventBus.localAudioEnabled.publish({ enabled: value, track: this });
  }

  /**
   * verify if the track id being passed is of this track for correlating server messages like audio level
   */
  isPublishedTrackId(trackId: string) {
    return this.publishedTrackId === trackId;
  }

  async setSettings(settings: Partial<IHMSAudioTrackSettings>, internal = false) {
    const newSettings = this.buildNewSettings(settings);

    if (isEmptyTrack(this.nativeTrack)) {
      // if it is an empty track, cache the settings for when it is unmuted
      this.settings = newSettings;
      return;
    }
    await this.handleDeviceChange(newSettings, internal);
    await this.handleSettingsChange(newSettings);
    this.settings = newSettings;
  }

  /**
   * @see HMSAudioPlugin
   */
  getPlugins(): string[] {
    return this.pluginsManager.getPlugins();
  }

  /**
   * @see HMSAudioPlugin
   */
  async addPlugin(plugin: HMSAudioPlugin): Promise<void> {
    return this.pluginsManager.addPlugin(plugin);
  }

  /**
   * @see HMSAudioPlugin
   */
  async removePlugin(plugin: HMSAudioPlugin): Promise<void> {
    return this.pluginsManager.removePlugin(plugin);
  }

  /**
   * @see HMSAudioPlugin
   */
  validatePlugin(plugin: HMSAudioPlugin): HMSPluginSupportResult {
    return this.pluginsManager.validatePlugin(plugin);
  }

  /**
   * @internal
   */
  async setProcessedTrack(processedTrack?: MediaStreamTrack) {
    // if all plugins are removed reset everything back to native track
    if (!processedTrack) {
      if (this.processedTrack) {
        // remove, reset back to the native track
        await (this.stream as HMSLocalStream).replaceSenderTrack(this.processedTrack, this.nativeTrack);
      }
      this.processedTrack = undefined;
      return;
    }
    if (processedTrack !== this.processedTrack) {
      if (this.processedTrack) {
        // replace previous processed track with new one
        await (this.stream as HMSLocalStream).replaceSenderTrack(this.processedTrack, processedTrack);
      } else {
        // there is no prev processed track, replace native with new one
        await (this.stream as HMSLocalStream).replaceSenderTrack(this.nativeTrack, processedTrack);
      }
      this.processedTrack = processedTrack;
    }
  }

  initAudioLevelMonitor() {
    if (this.audioLevelMonitor) {
      this.destroyAudioLevelMonitor();
    }
    HMSLogger.d(this.TAG, 'Monitor Audio Level for', this, this.getMediaTrackSettings().deviceId);
    this.audioLevelMonitor = new TrackAudioLevelMonitor(
      this,
      this.eventBus.trackAudioLevelUpdate,
      this.eventBus.localAudioSilence,
    );
    this.audioLevelMonitor.start();
    this.audioLevelMonitor.detectSilence();
  }

  destroyAudioLevelMonitor() {
    this.audioLevelMonitor?.stop();
    this.audioLevelMonitor = undefined;
  }

  async cleanup() {
    super.cleanup();
    await this.pluginsManager.cleanup();
    await this.pluginsManager.closeContext();
    this.transceiver = undefined;
    this.processedTrack?.stop();
    this.isPublished = false;
    this.destroyAudioLevelMonitor();
    if (isIOS() && isBrowser) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  /**
   * @internal
   * published track id will be different in case there was some processing done using plugins.
   */
  getTrackIDBeingSent() {
    return this.processedTrack ? this.processedTrack.id : this.nativeTrack.id;
  }

  /**
   * @internal
   */
  getTrackBeingSent() {
    return this.processedTrack || this.nativeTrack;
  }

  private buildNewSettings(settings: Partial<HMSAudioTrackSettings>) {
    const { volume, codec, maxBitrate, deviceId, advanced } = { ...this.settings, ...settings };
    const newSettings = new HMSAudioTrackSettings(volume, codec, maxBitrate, deviceId, advanced);
    return newSettings;
  }

  private handleSettingsChange = async (settings: HMSAudioTrackSettings) => {
    const stream = this.stream as HMSLocalStream;
    const hasPropertyChanged = generateHasPropertyChanged(settings, this.settings);
    if (hasPropertyChanged('maxBitrate') && settings.maxBitrate) {
      await stream.setMaxBitrateAndFramerate(this);
    }

    if (hasPropertyChanged('advanced')) {
      await this.replaceTrackWith(settings);
    }
  };

  /**
   * Replace audio track with new track on device change if enabled
   * @param settings - AudioSettings Object constructed with new settings
   * @param internal - whether the change was because of internal sdk call or external client call
   */
  private handleDeviceChange = async (settings: HMSAudioTrackSettings, internal = false) => {
    const hasPropertyChanged = generateHasPropertyChanged(settings, this.settings);
    if (hasPropertyChanged('deviceId')) {
      await this.replaceTrackWith(settings);
      if (!internal) {
        DeviceStorageManager.updateSelection('audioInput', {
          deviceId: settings.deviceId,
          groupId: this.nativeTrack.getSettings().groupId,
        });
      }
    }
  };
}
