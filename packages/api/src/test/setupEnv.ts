import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const uploadDir = join('/tmp', 'blather-api-test-uploads');
const ttsDir = join('/tmp', 'blather-api-test-tts');

mkdirSync(uploadDir, { recursive: true });
mkdirSync(ttsDir, { recursive: true });

process.env.BLATHER_UPLOAD_DIR ??= uploadDir;
process.env.BLATHER_TTS_DIR ??= ttsDir;
process.env.BLA_ALLOWED_EMAILS ??= '*';
