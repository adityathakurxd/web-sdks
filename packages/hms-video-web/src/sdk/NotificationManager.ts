import EventEmitter from 'events';
import HMSTrack from '../media/tracks/HMSTrack';
import { HMSRemoteTrack } from '../media/streams/HMSRemoteStream';
import HMSRemoteVideoTrack from '../media/tracks/HMSRemoteVideoTrack';
import HMSRemoteAudioTrack from '../media/tracks/HMSRemoteAudioTrack';
import { HMSTrackType } from '../media/tracks';
import { HMSLocalPeer, HMSPeer, HMSRemotePeer } from './models/peer';
import { HMSNotificationMethod } from './models/enums/HMSNotificationMethod';
import {
  Peer as PeerNotification,
  HMSNotifications,
  PeerList,
  TrackStateNotification,
  TrackState,
} from './models/HMSNotifications';
import HMSLogger from '../utils/logger';
import HMSUpdateListener, { HMSAudioListener, HMSPeerUpdate, HMSTrackUpdate } from '../interfaces/update-listener';
import { SpeakerList } from './models/HMSSpeaker';
import Message from './models/HMSMessage';

interface TrackStateEntry {
  peerId: string;
  trackInfo: TrackState;
}

// @TODO: Split into separate managers
export default class NotificationManager {
  hmsPeerList: Map<string, HMSRemotePeer> = new Map();
  localPeer!: HMSLocalPeer | null;

  private TAG: string = '[Notification Manager]:';
  private tracksToProcess: Map<string, HMSRemoteTrack> = new Map();
  private trackStateMap: Map<string, TrackStateEntry> = new Map();
  private listener!: HMSUpdateListener;
  private audioListener: HMSAudioListener | null = null;
  private eventEmitter: EventEmitter = new EventEmitter();

  handleNotification(
    method: HMSNotificationMethod,
    notification: HMSNotifications,
    isReconnecting: boolean,
    listener: HMSUpdateListener,
    audioListener: HMSAudioListener | null,
  ) {
    this.listener = listener;
    this.audioListener = audioListener;
    switch (method) {
      case HMSNotificationMethod.PEER_JOIN: {
        const peer = notification as PeerNotification;
        HMSLogger.d(this.TAG, `PEER_JOIN event`, peer);
        this.handlePeerJoin(peer);
        break;
      }
      case HMSNotificationMethod.PEER_LEAVE: {
        const peer = notification as PeerNotification;
        this.handlePeerLeave(peer);
        break;
      }
      case HMSNotificationMethod.PEER_LIST: {
        const peerList = notification as PeerList;
        if (isReconnecting) {
          HMSLogger.d(this.TAG, `RECONNECT_PEER_LIST event`, peerList);
          this.handleReconnectPeerList(peerList);
        } else {
          HMSLogger.d(this.TAG, `PEER_LIST event`, peerList);
          this.handleInitialPeerList(peerList);
        }
        break;
      }
      case HMSNotificationMethod.TRACK_METADATA_ADD: {
        this.handleTrackMetadataAdd(notification as TrackStateNotification);
        break;
      }
      case HMSNotificationMethod.TRACK_UPDATE: {
        this.handleTrackUpdate(notification as TrackStateNotification);
        break;
      }
      case HMSNotificationMethod.ROLE_CHANGE: {
        this.handleRoleChange(notification as TrackStateNotification);
        break;
      }
      case HMSNotificationMethod.ACTIVE_SPEAKERS:
        this.handleActiveSpeakers(notification as SpeakerList);
        break;

      case HMSNotificationMethod.BROADCAST:
        this.handleBroadcast(notification as Message);
        break;

      default:
        return;
    }
  }

  private handleRoleChange(params: TrackStateNotification) {
    // @DISCUSS: Make everything event based instead?
    this.eventEmitter.emit('role-change', { detail: { params } });
  }

  private handleTrackMetadataAdd(params: TrackStateNotification) {
    HMSLogger.d(this.TAG, `TRACK_METADATA_ADD`, params);

    for (const trackEntry of Object.values(params.tracks)) {
      this.trackStateMap.set(`${trackEntry.stream_id}${trackEntry.type}`, {
        peerId: params.peer.peer_id,
        trackInfo: trackEntry,
      });
    }

    this.processPendingTracks();
  }

  private processPendingTracks() {
    const tracksCopy = new Map(this.tracksToProcess);

    tracksCopy.forEach((track) => {
      const trackId = `${track.stream.id}${track.type}`;
      const state = this.trackStateMap.get(trackId);
      if (!state) return;

      const hmsPeer = this.hmsPeerList.get(state.peerId);
      if (!hmsPeer) return;

      track.source = state.trackInfo.source;
      track.setEnabled(!state.trackInfo.mute);

      switch (track.type) {
        case HMSTrackType.AUDIO:
          if (!hmsPeer.audioTrack) {
            hmsPeer.audioTrack = track as HMSRemoteAudioTrack;
          }
          // @DISCUSS: Do we have auxilliary audio tracks too?
          break;

        case HMSTrackType.VIDEO:
          if (!hmsPeer.videoTrack && track.source === 'regular') {
            hmsPeer.videoTrack = track as HMSRemoteVideoTrack;
          } else {
            hmsPeer.auxiliaryTracks.push(track);
          }
      }

      track.type === HMSTrackType.AUDIO && this.eventEmitter.emit('track-added', { detail: track });
      this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_ADDED, track, hmsPeer);
      this.tracksToProcess.delete(trackId);
    });
  }

  /**
   * Sets the tracks to peer and returns the peer
   */
  handleOnTrackAdd = (track: HMSTrack) => {
    HMSLogger.d(this.TAG, `ONTRACKADD`, track);
    this.tracksToProcess.set(`${track.stream.id}${track.type}`, track);
    this.processPendingTracks();
  };

  /**
   * Sets the track of corresponding peer to null and returns the peer
   */
  handleOnTrackRemove = (track: HMSTrack) => {
    HMSLogger.d(this.TAG, `ONTRACKREMOVE`, track);
    const trackStateEntry = this.trackStateMap.get(`${track.stream.id}${track.type}`);

    if (!trackStateEntry) return;

    const hmsPeer = this.hmsPeerList.get(trackStateEntry.peerId);

    if (hmsPeer) {
      switch (track.type) {
        case HMSTrackType.AUDIO:
          hmsPeer.audioTrack = undefined;
          break;
        case HMSTrackType.VIDEO: {
          const screenShareTrackIndex = hmsPeer.auxiliaryTracks.indexOf(track);

          if (screenShareTrackIndex > -1) {
            // @TODO: change this based on source
            hmsPeer.auxiliaryTracks.splice(screenShareTrackIndex, 1);
          } else {
            hmsPeer.videoTrack = undefined;
          }
        }
      }
      track.type === HMSTrackType.AUDIO && this.eventEmitter.emit('track-removed', { detail: track });
      this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, track, hmsPeer);
    }
  };

  private handleTrackUpdate = (params: TrackStateNotification) => {
    HMSLogger.d(this.TAG, `TRACK_UPDATE`, params);

    const hmsPeer = this.hmsPeerList.get(params.peer.peer_id);
    if (!hmsPeer) return;

    for (const trackEntry of Object.values(params.tracks)) {
      const trackId = `${trackEntry.stream_id}${trackEntry.type}`;
      const currentTrackStateInfo = Object.assign({}, this.trackStateMap.get(trackId)?.trackInfo);

      const track = this.getPeerTrackByTrackId(hmsPeer.peerId, trackId);

      this.trackStateMap.set(trackId, {
        peerId: params.peer.peer_id,
        trackInfo: { ...currentTrackStateInfo, ...trackEntry },
      });

      // TRACK_UPDATE came before TRACK_ADD -> update state, process pending tracks when TRACK_ADD arrives.
      if (!track || this.tracksToProcess.has(trackId)) {
        this.processPendingTracks();
      } else {
        track.setEnabled(!trackEntry.mute);

        if (currentTrackStateInfo.mute !== trackEntry.mute) {
          if (trackEntry.mute) {
            this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_MUTED, track, hmsPeer);
          } else {
            this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_UNMUTED, track, hmsPeer);
          }
        } else if (currentTrackStateInfo.description !== trackEntry.description) {
          this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_DESCRIPTION_CHANGED, track, hmsPeer);
        }
      }
    }
  };

  cleanUp = () => {
    this.hmsPeerList.clear();
  };

  findPeerByPeerId = (peerId: string) => {
    if (this.localPeer?.peerId === peerId) {
      return this.localPeer;
    }

    return this.hmsPeerList.get(peerId);
  };

  addEventListener(event: string, listener: EventListener) {
    this.eventEmitter.addListener(event, listener);
  }

  removeEventListener(event: string, listener: EventListener) {
    this.eventEmitter.removeListener(event, listener);
  }

  private handlePeerJoin = (peer: PeerNotification) => {
    const hmsPeer = new HMSRemotePeer({
      peerId: peer.peerId,
      name: peer.info.name,
      role: peer.role,
      customerUserId: peer.info.userId,
      customerDescription: peer.info.data,
    });

    this.hmsPeerList.set(peer.peerId, hmsPeer);
    HMSLogger.d(this.TAG, `adding to the peerList`, hmsPeer);

    peer.tracks.forEach((track) => {
      this.trackStateMap.set(`${track.stream_id}${track.type}`, {
        peerId: peer.peerId,
        trackInfo: track,
      });
    });

    this.listener!.onPeerUpdate(HMSPeerUpdate.PEER_JOINED, hmsPeer);
    this.processPendingTracks();
  };

  private handlePeerLeave = (peer: PeerNotification) => {
    const hmsPeer = this.findPeerByPeerId(peer.peerId);
    this.hmsPeerList.delete(peer.peerId);
    HMSLogger.d(this.TAG, `PEER_LEAVE event`, peer, this.hmsPeerList);

    if (hmsPeer) {
      if (hmsPeer.audioTrack) {
        this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, hmsPeer.audioTrack, hmsPeer);
      }

      if (hmsPeer.videoTrack) {
        this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, hmsPeer.videoTrack, hmsPeer);
      }

      hmsPeer.auxiliaryTracks?.forEach((track) => {
        this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, track, hmsPeer);
      });

      this.listener?.onPeerUpdate(HMSPeerUpdate.PEER_LEFT, hmsPeer);
    }
  };

  private handleInitialPeerList = (peerList: PeerList) => {
    const peers = peerList.peers;
    peers?.forEach((peer) => this.handlePeerJoin(peer));
  };

  private handleReconnectPeerList = (peerList: PeerList) => {
    const currentPeerList = Array.from(this.hmsPeerList.values());
    const peersToRemove = currentPeerList.filter(
      (hmsPeer) => !peerList.peers.some((peer) => peer.peerId === hmsPeer.peerId),
    );

    HMSLogger.d(this.TAG, { peersToRemove });

    // Send peer-leave updates to all the missing peers
    peersToRemove.forEach((peer) => {
      const peerNotification = new PeerNotification({
        peer_id: peer.peerId,
        role: peer.role,
        info: {
          name: peer.name,
          data: peer.customerDescription,
          user_id: peer.customerUserId,
        },
      });

      this.handlePeerLeave(peerNotification);
    });

    // Check for any tracks which are added/removed
    peerList.peers.forEach((newPeerNotification) => {
      const oldPeer = this.findPeerByPeerId(newPeerNotification.peerId);

      if (oldPeer) {
        // Peer already present in room, we take diff between the tracks
        const tracks = [...oldPeer.auxiliaryTracks]; // Clone array to avoid pushing into auxiliaryTracks
        oldPeer.audioTrack && tracks.push(oldPeer.audioTrack);
        oldPeer.videoTrack && tracks.push(oldPeer.videoTrack);

        // Remove all the tracks which are not present in the peer.tracks
        tracks.forEach((track) => {
          if (
            !newPeerNotification.tracks.some((newTrack) => {
              return newTrack.stream_id === track.stream.id && newTrack.type === track.type;
            })
          ) {
            this.removePeerTrack(oldPeer, track.trackId);
            this.listener.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, track, oldPeer);
          }
        });

        // Add track-metadata for all the new tracks
        newPeerNotification.tracks.forEach((trackData) => {
          if (!this.getPeerTrackByTrackId(oldPeer.peerId, trackData.track_id)) {
            // NOTE: We assume that, once the connection is re-established,
            //  transport layer will send a native onTrackAdd
            this.trackStateMap.set(`${trackData.stream_id}${trackData.type}`, {
              peerId: oldPeer.peerId,
              trackInfo: trackData,
            });
          }
        });
        this.processPendingTracks();
      } else {
        // New peer joined while reconnecting
        this.handlePeerJoin(newPeerNotification);
      }
    });
  };

  /**
   * @param speakerList List of speakers[peer_id, level] sorted by level in descending order.
   */
  private handleActiveSpeakers(speakerList: SpeakerList) {
    const speakers = speakerList.speakers;
    this.audioListener?.onAudioLevelUpdate(speakers);
    const dominantSpeaker = speakers[0];
    if (dominantSpeaker) {
      const dominantSpeakerPeer = this.findPeerByPeerId(dominantSpeaker.peerId);
      this.listener.onPeerUpdate(HMSPeerUpdate.BECAME_DOMINANT_SPEAKER, dominantSpeakerPeer!);
    } else {
      this.listener.onPeerUpdate(HMSPeerUpdate.RESIGNED_DOMINANT_SPEAKER, null);
    }
  }

  private handleBroadcast(message: Message) {
    HMSLogger.d(this.TAG, `Received Message:: `, message);
    this.listener?.onMessageReceived(message);
  }

  private getPeerTrackByTrackId(peerId: string, trackId: string) {
    const peer = this.findPeerByPeerId(peerId);

    if (this.getTrackId(peer?.audioTrack) === trackId) {
      return peer?.audioTrack;
    } else if (this.getTrackId(peer?.videoTrack) === trackId) {
      return peer?.videoTrack;
    } else {
      return peer?.auxiliaryTracks.find((track) => track.trackId === trackId);
    }
  }

  private removePeerTrack(peer: HMSPeer, trackId: string) {
    if (peer.audioTrack?.trackId === trackId) {
      peer.audioTrack = undefined;
    } else if (peer.videoTrack?.trackId === trackId) {
      peer.videoTrack = undefined;
    } else {
      const track = peer.auxiliaryTracks.find((track) => track.trackId === trackId);
      track && peer.auxiliaryTracks.splice(peer.auxiliaryTracks.indexOf(track), 1);
    }
  }

  private getTrackId(track: HMSTrack | null | undefined) {
    if (!track) {
      return null;
    }
    return `${track.stream.id}${track.type}`;
  }
}
