export const GAME_EVENT = {
	CREATE: 'game:create',
	TRAINING: 'game:training',
	QUICKPLAY: 'game:quickplay',
	REMATCH: 'game:rematch',
	REMATCH_OFFERED: 'game:rematchOffered',
	REMATCH_CANCELLED: 'game:rematchCancelled',
	CHALLENGE: 'game:challenge',
	CHALLENGE_SENT: 'game:challengeSent',
	CHALLENGED: 'game:challenged',
	CHALLENGE_ANSWER: 'game:challengeAnswer',
	CHALLENGE_CANCEL: 'game:challengeCancel',
	CHALLENGE_ENDED: 'game:challengeEnded',
	CANCEL: 'game:cancel',
	JOIN: 'game:join',
	SPECTATE: 'game:spectate',
	LEAVE: 'game:leave',
	INPUT: 'game:input',
	CREATED: 'game:created',
	CANCELLED: 'game:cancelled',
	NAVIGATE: 'game:navigate',
	SPECTATING: 'game:spectating',
	START: 'game:start',
	STATE: 'game:state',
	ROUND_START: 'game:roundStart',
	ROUND_END: 'game:roundEnd',
	MATCH_END: 'game:matchEnd',
	ABANDONED: 'game:abandoned',
	CLOSED: 'game:closed',
	ERROR: 'game:error'
} as const;

export const LOBBY_EVENT = {
	STATE: 'lobby:state',
	USER_JOIN: 'user:join',
	CHAT_MESSAGE: 'chat:message'
} as const;
