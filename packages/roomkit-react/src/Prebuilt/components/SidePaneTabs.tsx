import React, { useEffect, useState } from 'react';
import { useMedia } from 'react-use';
import { ConferencingScreen } from '@100mslive/types-prebuilt';
import { selectPeerCount, useHMSStore } from '@100mslive/react-sdk';
import { CrossIcon } from '@100mslive/react-icons';
// @ts-ignore: No implicit Any
import { Chat } from './Chat/Chat';
// @ts-ignore: No implicit Any
import { ParticipantList } from './Footer/ParticipantList';
import { config as cssConfig, Flex, IconButton, Tabs, Text } from '../..';
// @ts-ignore: No implicit Any
import { useRoomLayoutConferencingScreen } from '../provider/roomLayoutProvider/hooks/useRoomLayoutScreen';
// @ts-ignore: No implicit Any
import { useIsSidepaneTypeOpen, useSidepaneReset, useSidepaneToggle } from './AppData/useSidepane';
// @ts-ignore: No implicit Any
import { SIDE_PANE_OPTIONS } from '../common/constants';

const tabTriggerCSS = {
  color: '$on_surface_high',
  p: '$4',
  fontWeight: '$semiBold',
  fontSize: '$sm',
  w: '100%',
  justifyContent: 'center',
};

export const SidePaneTabs = React.memo<{
  active: 'Participants | Chat';
  screenType: keyof ConferencingScreen;
  hideControls?: boolean;
}>(({ active = SIDE_PANE_OPTIONS.CHAT, screenType, hideControls }) => {
  const toggleChat = useSidepaneToggle(SIDE_PANE_OPTIONS.CHAT);
  const toggleParticipants = useSidepaneToggle(SIDE_PANE_OPTIONS.PARTICIPANTS);
  const resetSidePane = useSidepaneReset();
  const [activeTab, setActiveTab] = useState(active);
  const peerCount = useHMSStore(selectPeerCount);
  const { elements } = useRoomLayoutConferencingScreen();
  const showChat = !!elements?.chat;
  const showParticipants = !!elements?.participant_list;
  const hideTabs = !(showChat && showParticipants);
  const isMobile = useMedia(cssConfig.media.md);
  const isOverlayChat = !!elements?.chat?.is_overlay && isMobile;
  const isChatOpen = useIsSidepaneTypeOpen(SIDE_PANE_OPTIONS.CHAT);

  useEffect(() => {
    if (activeTab === SIDE_PANE_OPTIONS.CHAT && !showChat && showParticipants) {
      setActiveTab(SIDE_PANE_OPTIONS.PARTICIPANTS);
    } else if (activeTab === SIDE_PANE_OPTIONS.PARTICIPANTS && showChat && !showParticipants) {
      setActiveTab(SIDE_PANE_OPTIONS.CHAT);
    } else if (!showChat && !showParticipants) {
      resetSidePane();
    }
  }, [showChat, activeTab, showParticipants, resetSidePane]);

  useEffect(() => {
    setActiveTab(active);
  }, [active]);

  return (
    <Flex
      direction="column"
      css={{
        color: '$on_primary_high',
        h: '100%',
        marginTop: hideControls && isOverlayChat ? '$17' : '0',
        transition: 'margin 0.3s ease-in-out',
      }}
    >
      {isOverlayChat && isChatOpen && showChat ? (
        <Chat screenType={screenType} />
      ) : (
        <>
          {hideTabs ? (
            <>
              <Text variant="sm" css={{ fontWeight: '$semiBold', p: '$4', c: '$on_surface_high', pr: '$12' }}>
                {showChat ? 'Chat' : `Participants (${peerCount})`}
              </Text>

              {showChat ? <Chat screenType={screenType} /> : <ParticipantList />}
            </>
          ) : (
            <Tabs.Root
              value={activeTab}
              onValueChange={setActiveTab}
              css={{
                flexDirection: 'column',
                size: '100%',
              }}
            >
              <Tabs.List css={{ w: 'calc(100% - $12)', p: '$2', borderRadius: '$2', bg: '$surface_default' }}>
                <Tabs.Trigger
                  value={SIDE_PANE_OPTIONS.CHAT}
                  onClick={toggleChat}
                  css={{
                    ...tabTriggerCSS,
                    color: activeTab !== SIDE_PANE_OPTIONS.CHAT ? '$on_surface_low' : '$on_surface_high',
                  }}
                >
                  Chat
                </Tabs.Trigger>
                <Tabs.Trigger
                  value={SIDE_PANE_OPTIONS.PARTICIPANTS}
                  onClick={toggleParticipants}
                  css={{
                    ...tabTriggerCSS,
                    color: activeTab !== SIDE_PANE_OPTIONS.PARTICIPANTS ? '$on_surface_low' : '$on_surface_high',
                  }}
                >
                  Participants ({peerCount})
                </Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value={SIDE_PANE_OPTIONS.PARTICIPANTS} css={{ p: 0 }}>
                <ParticipantList />
              </Tabs.Content>
              <Tabs.Content value={SIDE_PANE_OPTIONS.CHAT} css={{ p: 0 }}>
                <Chat screenType={screenType} />
              </Tabs.Content>
            </Tabs.Root>
          )}
        </>
      )}

      {isOverlayChat && isChatOpen ? null : (
        <IconButton
          css={{ position: 'absolute', right: '$10', top: '$11', '@md': { top: '$8', right: '$8' } }}
          onClick={e => {
            e.stopPropagation();
            if (activeTab === SIDE_PANE_OPTIONS.CHAT) {
              toggleChat();
            } else {
              toggleParticipants();
            }
          }}
          data-testid="close_chat"
        >
          <CrossIcon />
        </IconButton>
      )}
    </Flex>
  );
});