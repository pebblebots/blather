import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChannelContextMenu } from './ChannelContextMenu';

afterEach(() => {
  cleanup();
});

function renderMenu(channelOverrides?: Partial<Parameters<typeof ChannelContextMenu>[0]['channel']>) {
  const onClose = vi.fn();
  const onArchive = vi.fn();
  const onDelete = vi.fn();
  const onInvite = vi.fn();

  render(
    <ChannelContextMenu
      x={120}
      y={240}
      channel={{
        id: 'ch-1',
        channelType: 'private',
        isDefault: false,
        ...channelOverrides,
      }}
      onClose={onClose}
      onArchive={onArchive}
      onDelete={onDelete}
      onInvite={onInvite}
    />
  );

  return { onClose, onArchive, onDelete, onInvite };
}

describe('ChannelContextMenu', () => {
  it('shows invite action only for private channels', () => {
    renderMenu({ channelType: 'private' });
    expect(screen.getByRole('button', { name: '👥 Invite Members' })).toBeInTheDocument();

    cleanup();
    renderMenu({ channelType: 'public' });
    expect(screen.queryByRole('button', { name: '👥 Invite Members' })).not.toBeInTheDocument();
  });

  it('archives a non-default channel and closes the menu', () => {
    const { onArchive, onClose } = renderMenu({ isDefault: false });

    fireEvent.click(screen.getByRole('button', { name: '📦 Archive Channel' }));

    expect(onArchive).toHaveBeenCalledWith('ch-1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('disables archive for the default channel', () => {
    const { onArchive, onClose } = renderMenu({ isDefault: true });

    const archiveButton = screen.getByRole('button', { name: '📦 Archive Channel' });
    expect(archiveButton).toBeDisabled();

    fireEvent.click(archiveButton);

    expect(onArchive).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('deletes the channel and closes the menu', () => {
    const { onDelete, onClose } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: '🗑️ Delete Channel' }));

    expect(onDelete).toHaveBeenCalledWith('ch-1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('invites to the channel and closes the menu', () => {
    const { onInvite, onClose } = renderMenu({ channelType: 'private' });

    fireEvent.click(screen.getByRole('button', { name: '👥 Invite Members' }));

    expect(onInvite).toHaveBeenCalledWith('ch-1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the backdrop is clicked or right-clicked', () => {
    const { onClose } = renderMenu();
    const backdrop = screen.getByTestId('context-menu-backdrop');

    fireEvent.click(backdrop);
    fireEvent.contextMenu(backdrop);

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
