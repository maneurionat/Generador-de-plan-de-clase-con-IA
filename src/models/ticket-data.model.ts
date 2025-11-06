
export interface TicketData {
  Timestamp: Date;
  'Email Address': string;
  Materia: string;
  Paralelo: string;
  [key: string]: any; // For dynamic question keys
}

export interface FilterOptions {
    materias: string[];
    paralelos: string[];
}
