import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MarkdownText } from './MarkdownText';

afterEach(() => cleanup());

describe('MarkdownText', () => {
  it('renders plain text', () => {
    render(<MarkdownText text="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('renders **bold** text', () => {
    const { container } = render(<MarkdownText text="this is **bold** text" />);
    const strong = container.querySelector('strong');
    expect(strong).toHaveTextContent('bold');
  });

  it('renders *italic* text', () => {
    const { container } = render(<MarkdownText text="this is *italic* text" />);
    const em = container.querySelector('em');
    expect(em).toHaveTextContent('italic');
  });

  it('renders `code` inline', () => {
    const { container } = render(<MarkdownText text="use `console.log`" />);
    const code = container.querySelector('code');
    expect(code).toHaveTextContent('console.log');
  });

  it('renders ~~strikethrough~~ text', () => {
    const { container } = render(<MarkdownText text="~~removed~~" />);
    const del = container.querySelector('del');
    expect(del).toHaveTextContent('removed');
  });

  it('renders [links](url)', () => {
    const { container } = render(<MarkdownText text="click [here](https://example.com)" />);
    const link = container.querySelector('a');
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveTextContent('here');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders ***bold+italic*** text', () => {
    const { container } = render(<MarkdownText text="this is ***bold italic*** text" />);
    const strong = container.querySelector('strong');
    const em = strong?.querySelector('em');
    expect(strong).toBeInTheDocument();
    expect(em).toHaveTextContent('bold italic');
  });

  it('renders multiple features in one line', () => {
    const { container } = render(
      <MarkdownText text="**bold** and *italic* and `code`" />
    );
    expect(container.querySelector('strong')).toHaveTextContent('bold');
    expect(container.querySelector('em')).toHaveTextContent('italic');
    expect(container.querySelector('code')).toHaveTextContent('code');
  });

  it('preserves line breaks', () => {
    const { container } = render(<MarkdownText text={'line1\nline2'} />);
    const brs = container.querySelectorAll('br');
    expect(brs.length).toBe(1);
  });

  it('renders empty string without error', () => {
    const { container } = render(<MarkdownText text="" />);
    expect(container.querySelector('span')).toBeInTheDocument();
  });
});
