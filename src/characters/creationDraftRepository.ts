import { asyncStorageAdapter } from '../storage/asyncStorageAdapter';
import { CharacterCreationDraftRepository } from './creationDraft';

export const characterCreationDraftRepository = new CharacterCreationDraftRepository(asyncStorageAdapter);
