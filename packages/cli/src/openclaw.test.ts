import { describe, it, expect } from 'vitest';
import { parseChannelRefs, applyTemplateVars, AGENT_DOMAIN } from './openclaw.js';

describe('parseChannelRefs', () => {
  it('extracts channel slugs from text', () => {
    expect(parseChannelRefs('Post in #codework and #general')).toEqual(
      expect.arrayContaining(['codework', 'general']),
    );
  });

  it('ignores markdown headers', () => {
    const md = `# Heading\n## Subheading\n### Another\nCheck #codework`;
    expect(parseChannelRefs(md)).toEqual(['codework']);
  });

  it('handles channels with hyphens and underscores', () => {
    expect(parseChannelRefs('see #dev-ops and #my_channel')).toEqual(
      expect.arrayContaining(['dev-ops', 'my_channel']),
    );
  });

  it('deduplicates refs', () => {
    expect(parseChannelRefs('#all and #all again')).toEqual(['all']);
  });

  it('returns empty for no refs', () => {
    expect(parseChannelRefs('No channels here')).toEqual([]);
  });

  it('ignores refs starting with numbers', () => {
    expect(parseChannelRefs('issue #123 is tracked')).toEqual([]);
  });

  it('ignores uppercase (not valid channel slugs)', () => {
    expect(parseChannelRefs('see #README and #codework')).toEqual(['codework']);
  });

  it('extracts from start of line', () => {
    expect(parseChannelRefs('#all is the main channel')).toEqual(['all']);
  });

  it('handles real clanker template content', () => {
    const template = `
## Blather
- Check #codework for new task requests
- Channel: #all (API: \`/channels/all/...\`)
- Channel: #codework (API: \`/channels/codework/messages\`)
# Heading that should be ignored
`;
    const refs = parseChannelRefs(template);
    expect(refs).toEqual(expect.arrayContaining(['codework', 'all']));
    expect(refs).toHaveLength(2);
  });
});

describe('applyTemplateVars', () => {
  it('replaces template variables', () => {
    const result = applyTemplateVars('API: $API_BASE, WS: $WORKSPACE_ID', {
      '$API_BASE': 'http://localhost:3000',
      '$WORKSPACE_ID': 'ws-123',
    });
    expect(result).toBe('API: http://localhost:3000, WS: ws-123');
  });

  it('replaces all occurrences', () => {
    const result = applyTemplateVars('$X and $X', { '$X': 'y' });
    expect(result).toBe('y and y');
  });

  it('leaves content unchanged with no matching vars', () => {
    const result = applyTemplateVars('nothing to replace', { '$FOO': 'bar' });
    expect(result).toBe('nothing to replace');
  });

  it('handles $REPO_ROOT_PATH', () => {
    const result = applyTemplateVars('path: $REPO_ROOT_PATH/packages', {
      '$REPO_ROOT_PATH': '/home/user/project',
    });
    expect(result).toBe('path: /home/user/project/packages');
  });

  it('handles all template vars together', () => {
    const vars = {
      '$API_BASE': 'http://localhost:3000',
      '$WORKSPACE_ID': 'abc-123',
      '$WEB_URL': 'http://localhost:8080',
      '$REPO_ROOT_PATH': '/home/user/blather',
    };
    const input = 'api=$API_BASE ws=$WORKSPACE_ID web=$WEB_URL root=$REPO_ROOT_PATH';
    const result = applyTemplateVars(input, vars);
    expect(result).toBe(
      'api=http://localhost:3000 ws=abc-123 web=http://localhost:8080 root=/home/user/blather',
    );
  });
});

describe('AGENT_DOMAIN', () => {
  it('is system.blather', () => {
    expect(AGENT_DOMAIN).toBe('system.blather');
  });
});
