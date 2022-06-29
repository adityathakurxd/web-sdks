import React from 'react';
import { ComponentMeta } from '@storybook/react';
import { TileMenu } from './TileMenu';
import { Box } from '../Layout';

export default {
  title: 'UI Components/TileMenu',
  component: TileMenu,
} as ComponentMeta<typeof TileMenu>;

const TileMenuStory = () => {
  return (
    <Box css={{ width: '300px', height: '300px', position: 'relative', bg: '$bgSecondary' }}>
      <TileMenu peerId="1" />
    </Box>
  );
};

export const Base = TileMenuStory.bind({});