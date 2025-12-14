export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface AudioVisualizerProps {
  stream: MediaStream | null;
  isActive: boolean;
  color: string;
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  sender: 'user' | 'model';
  text: string;
}