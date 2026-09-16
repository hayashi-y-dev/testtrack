export interface MemberListItem {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: string;
  isMe: boolean;
}

export interface SearchResultItem {
  userId: string;
  displayName: string;
  email: string;
  alreadyJoined: boolean;
}
