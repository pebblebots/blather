import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageInput } from './MessageInput';

// Mock uploadFile to avoid real XHR
vi.mock('../lib/api', () => ({
  uploadFile: vi.fn(),
}));

afterEach(() => cleanup());

/** The visible text input (not the hidden file input) */
function getInput() {
  return screen.getByPlaceholderText('Type a message...') as HTMLInputElement;
}

describe('MessageInput', () => {
  it('renders input and send button', () => {
    render(<MessageInput onSend={vi.fn()} />);
    expect(getInput()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('calls onSend with trimmed text on Enter', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} />);

    const input = getInput();
    await user.type(input, 'hello world{Enter}');

    expect(onSend).toHaveBeenCalledWith('hello world', undefined);
  });

  it('clears input after send', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} />);

    const input = getInput();
    await user.type(input, 'hello{Enter}');

    expect(input).toHaveValue('');
  });

  it('does not send empty message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} />);

    const input = getInput();
    await user.type(input, '   {Enter}');

    expect(onSend).not.toHaveBeenCalled();
  });

  it('calls onTyping when user types (throttled)', async () => {
    const onTyping = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} onTyping={onTyping} />);

    const input = getInput();
    await user.type(input, 'abc');

    expect(onTyping).toHaveBeenCalledTimes(1);
  });

  it('send button is disabled when input is empty', () => {
    render(<MessageInput onSend={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeDisabled();
  });

  it('send button is enabled when input has text', async () => {
    const user = userEvent.setup();
    render(<MessageInput onSend={vi.fn()} />);

    await user.type(getInput(), 'hi');
    const btn = screen.getByRole('button', { name: /send/i });
    expect(btn).toBeEnabled();
  });

  it('calls onSend when clicking the Send button', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<MessageInput onSend={onSend} />);

    await user.type(getInput(), 'click send');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSend).toHaveBeenCalledWith('click send', undefined);
  });

  it('disables input when disabled prop is true', () => {
    render(<MessageInput onSend={vi.fn()} disabled />);
    expect(getInput()).toBeDisabled();
  });

  it('has safe-area-bottom class on wrapper for iOS PWA support (T#69)', () => {
    const { container } = render(<MessageInput onSend={vi.fn()} />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains('safe-area-bottom')).toBe(true);
  });
});
