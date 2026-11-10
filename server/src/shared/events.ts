export type GamePhase = "waiting" | "playing" | "roundEnd" | "matchEnd";

export const GAME_EVENT = {
  CREATE: "game:create",
  CANCEL: "game:cancel",
  JOIN: "game:join",
  SPECTATE: "game:spectate",
  LEAVE: "game:leave",
  INPUT: "game:input",
  CREATED: "game:created",
  CANCELLED: "game:cancelled",
  NAVIGATE: "game:navigate",
  SPECTATING: "game:spectating",
  START: "game:start",
  STATE: "game:state",
  ROUND_START: "game:roundStart",
  ROUND_END: "game:roundEnd",
  MATCH_END: "game:matchEnd",
  ABANDONED: "game:abandoned",
  CLOSED: "game:closed",
  ERROR: "game:error",
} as const;

export const LOBBY_EVENT = {
  STATE: "lobby:state",
  USER_JOIN: "user:join",
  CHAT_MESSAGE: "chat:message",
} as const;

export const DEFAULT_LOADOUT = {
  ship: "ship1",
  bulletPrimary: "bullet1",
  bulletSecondary: "bullet3",
} as const;
