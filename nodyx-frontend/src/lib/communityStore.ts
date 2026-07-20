import { writable } from 'svelte/store';

/** The active federated community name selected in the rail. Null means local community. */
export const activeCommunityNameStore = writable<string | null>(null);

/** Whether the channel panel is collapsed */
export const panelCollapsedStore = writable<boolean>(false);

/** Whether the members sidebar is collapsed */
export const membersCollapsedStore = writable<boolean>(false);
