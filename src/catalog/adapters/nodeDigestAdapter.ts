import { createHash } from 'node:crypto';
import type { DigestAdapter } from '../types';

export const nodeDigestAdapter: DigestAdapter = {
  async sha256(input: string): Promise<string> {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }
};
