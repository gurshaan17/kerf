import { safeStorage } from 'electron';

export const electronSecrets = {
  encrypt(value: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'The operating system credential store is unavailable. Kerf will not store API keys in plain text.',
      );
    }
    return safeStorage.encryptString(value);
  },
  decrypt(value: Buffer): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('The operating system credential store is unavailable.');
    }
    return safeStorage.decryptString(value);
  },
};
