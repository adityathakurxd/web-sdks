import React, { Fragment, useState } from "react";
import {
  HamburgerMenuIcon,
  RecordIcon,
  TextboxIcon,
} from "@100mslive/react-icons";
import { selectPermissions, useHMSStore } from "@100mslive/react-sdk";
import { Dropdown, IconButton, Text, Tooltip } from "@100mslive/react-ui";
import { ChangeName } from "../../components/ChangeName";
import { ChangeSelfRole } from "./ChangeSelfRole";
import { RecordingAndRTMPModal } from "../../components/RecordingAndRTMPModal";

const hoverStyles = {
  "&:hover": {
    cursor: "pointer",
  },
};

export const MoreSettings = () => {
  const permissions = useHMSStore(selectPermissions);
  const [open, setOpen] = useState(false);
  const [showChangeNameModal, setShowChangeNameModal] = useState(false);
  const [showRecordingModal, setShowRecordingModal] = useState(false);

  return (
    <Fragment>
      <Dropdown.Root open={open} onOpenChange={setOpen}>
        <Tooltip title="More Settings">
          <Dropdown.Trigger asChild>
            <IconButton active={!open}>
              <HamburgerMenuIcon />
            </IconButton>
          </Dropdown.Trigger>
        </Tooltip>
        <Dropdown.Content sideOffset={5} align="center">
          <Dropdown.Item
            css={hoverStyles}
            onClick={() => setShowChangeNameModal(value => !value)}
          >
            <TextboxIcon />
            <Text variant="sm" css={{ ml: "$4" }}>
              Change Name
            </Text>
          </Dropdown.Item>
          <ChangeSelfRole css={hoverStyles} />
          {(permissions.streaming || permissions.recording) && (
            <Dropdown.Item
              onClick={() => setShowRecordingModal(true)}
              css={hoverStyles}
            >
              <RecordIcon />
              <Text variant="sm" css={{ ml: "$4" }}>
                Streaming/Recording
              </Text>
            </Dropdown.Item>
          )}
        </Dropdown.Content>
      </Dropdown.Root>
      <ChangeName
        show={showChangeNameModal}
        onToggle={value => setShowChangeNameModal(value)}
      />
      <RecordingAndRTMPModal
        show={showRecordingModal}
        onToggle={value => setShowRecordingModal(value)}
        permissions={permissions}
      />
    </Fragment>
  );
};
