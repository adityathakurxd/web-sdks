import React from 'react';
import { useMeasure } from 'react-use';
import { FixedSizeList } from 'react-window';
import { HMSPeer } from '@100mslive/react-sdk';
import { Accordion } from '../../../Accordion';
import { Box, Flex } from '../../../Layout';
import { Text } from '../../../Text';
// @ts-ignore: No implicit Any
import { Participant } from './ParticipantList';
import { RoleOptions } from './RoleOptions';
// @ts-ignore: No implicit Any
import { getFormattedCount } from '../../common/utils';

const ROW_HEIGHT = 50;

interface ItemData {
  peerList: HMSPeer[];
  isConnected: boolean;
}

function itemKey(index: number, data: ItemData) {
  return data.peerList[index].id;
}

const VirtualizedParticipantItem = React.memo(({ index, data }: { index: number; data: ItemData }) => {
  return <Participant key={data.peerList[index].id} peer={data.peerList[index]} isConnected={data.isConnected} />;
});

export const RoleAccordion = ({
  peerList = [],
  roleName,
  isConnected,
  filter,
  isHandRaisedAccordion = false,
}: ItemData & {
  roleName: string;
  isHandRaisedAccordion?: boolean;
  filter?: { search: string };
}) => {
  const [ref, { width }] = useMeasure<HTMLDivElement>();
  const showAcordion = filter?.search ? peerList.some(peer => peer.name.toLowerCase().includes(filter.search)) : true;

  if (!showAcordion || (isHandRaisedAccordion && filter?.search) || peerList.length === 0) {
    return null;
  }
  const height = ROW_HEIGHT * peerList.length;

  return (
    <Flex direction="column" css={{ flexGrow: 1, '&:hover .role_actions': { visibility: 'visible' } }} ref={ref}>
      <Accordion.Root
        type="single"
        collapsible
        defaultValue={roleName}
        css={{ borderRadius: '$1', border: '1px solid $border_bright' }}
      >
        <Accordion.Item value={roleName}>
          <Accordion.Header
            iconStyles={{ c: '$on_surface_high' }}
            css={{
              textTransform: 'capitalize',
              p: '$6 $8',
              fontSize: '$sm',
              fontWeight: '$semiBold',
              c: '$on_surface_medium',
            }}
          >
            <Flex justify="between" css={{ flexGrow: 1, pr: '$6' }}>
              <Text
                variant="sm"
                css={{ fontWeight: '$semiBold', textTransform: 'capitalize', color: '$on_surface_medium' }}
              >
                {roleName} {`(${getFormattedCount(peerList.length)})`}
              </Text>
              <RoleOptions roleName={roleName} peerList={peerList} />
            </Flex>
          </Accordion.Header>
          <Accordion.Content>
            <Box css={{ borderTop: '1px solid $border_default' }} />
            <FixedSizeList
              itemSize={ROW_HEIGHT}
              itemData={{ peerList, isConnected }}
              itemKey={itemKey}
              itemCount={peerList.length}
              width={width}
              height={height}
            >
              {VirtualizedParticipantItem}
            </FixedSizeList>
          </Accordion.Content>
        </Accordion.Item>
      </Accordion.Root>
    </Flex>
  );
};