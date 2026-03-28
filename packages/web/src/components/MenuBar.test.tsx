import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import MenuBar from './MenuBar';

afterEach(() => cleanup());

describe('MenuBar', () => {
  it('renders default menu items', () => {
    render(<MenuBar />);
    expect(screen.getByText('🍎')).toBeTruthy();
    expect(screen.getByText('File')).toBeTruthy();
    expect(screen.getByText('Edit')).toBeTruthy();
    expect(screen.getByText('View')).toBeTruthy();
    expect(screen.getByText('Help')).toBeTruthy();
  });

  it('does not render Window by default', () => {
    render(<MenuBar />);
    expect(screen.queryByText('Window')).toBeNull();
  });

  it('renders Window when showWindow is true', () => {
    render(<MenuBar showWindow />);
    expect(screen.getByText('Window')).toBeTruthy();
  });

  it('does not render extras by default', () => {
    render(<MenuBar />);
    expect(screen.queryByTitle('Start a Huddle')).toBeNull();
  });

  it('renders huddle mic and command icon when showExtras is true', () => {
    render(<MenuBar showExtras />);
    expect(screen.getByTitle('Start a Huddle')).toBeTruthy();
    expect(screen.getByText('⌘')).toBeTruthy();
  });

  it('calls onHelpClick when Help is clicked', () => {
    const handler = vi.fn();
    render(<MenuBar onHelpClick={handler} />);
    fireEvent.click(screen.getByText('Help'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls onHuddleClick when huddle mic is clicked', () => {
    const handler = vi.fn();
    render(<MenuBar showExtras onHuddleClick={handler} />);
    fireEvent.click(screen.getByTitle('Start a Huddle'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('applies custom style to root element', () => {
    const { container } = render(<MenuBar style={{ display: 'none' }} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.display).toBe('none');
  });

  it('Help span has pointer cursor only when onHelpClick is provided', () => {
    const { rerender } = render(<MenuBar />);
    const helpNoHandler = screen.getByText('Help');
    expect(helpNoHandler.style.cursor).toBe('');

    rerender(<MenuBar onHelpClick={() => {}} />);
    const helpWithHandler = screen.getByText('Help');
    expect(helpWithHandler.style.cursor).toBe('pointer');
  });
});
