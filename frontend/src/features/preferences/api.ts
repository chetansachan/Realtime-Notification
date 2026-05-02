import type { ApiClient } from '../../lib/api.js';
import type {
  CategoriesResponse,
  PreferenceItem,
  PreferencesResponse,
} from '../../lib/types.js';

export interface PreferencesApi {
  list(token: string): Promise<PreferencesResponse>;
  update(token: string, preferences: PreferenceItem[]): Promise<PreferencesResponse>;
  categories(token: string): Promise<CategoriesResponse>;
}

export function createPreferencesApi(api: ApiClient): PreferencesApi {
  return {
    list(token) {
      return api.get<PreferencesResponse>('/v1/preferences', token);
    },
    update(token, preferences) {
      return api.put<PreferencesResponse>('/v1/preferences', { preferences }, token);
    },
    categories(token) {
      return api.get<CategoriesResponse>('/v1/categories', token);
    },
  };
}
