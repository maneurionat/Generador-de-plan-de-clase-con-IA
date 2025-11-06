
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TicketData } from '../models/ticket-data.model';

declare var Papa: any;

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private http = inject(HttpClient);

  // Column headers from the original form
  public readonly learningIndex = "¿Cuál es el aprendizaje más importante que te llevas de la clase de hoy?";
  public readonly confusedIndex = "¿Qué punto de la clase te resultó más confuso o te dejó con dudas?";
  public readonly questionIndex = "¿Tienes alguna pregunta que te gustaría que sea respondida la siguiente clase?"; 
  public readonly comprehensionIndex = "Sobre tu nivel de comprensión de la clase de hoy, marca una opción:  ";
  public readonly suggestionIndex = "¿Cómo puedo ayudarte a comprender mejor el tema avanzado?"; 
  public readonly engagementIndex = "Pensando en tu participación y esfuerzo en la clase de hoy, ¿cómo te autoevaluarías? Marca una opción:";
  public readonly scoreIndex = "Mi satisfacción con la clase fue... (Califica la clase de hoy en un puntaje del 1 al 10, donde 1 es insatisfecho y 10 es muy satisfecho)";

  public readonly requiredHeaders = [
    "Timestamp", "Email Address", "Materia", "Paralelo",
    this.learningIndex, this.confusedIndex, this.questionIndex, 
    this.comprehensionIndex, this.suggestionIndex, this.engagementIndex, this.scoreIndex
  ];

  async loadDataFromSheet(url: string): Promise<TicketData[]> {
    if (!url) {
      throw new Error("Por favor, introduce una URL válida.");
    }

    let csvUrl = '';
    const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    
    if (match && match[1]) {
        const sheetId = match[1];
        const gidMatch = url.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    } else {
        throw new Error("Formato de URL no válido. Por favor, usa la URL estándar de Google Sheet.");
    }
    
    const csvData = await firstValueFrom(this.http.get(csvUrl, { responseType: 'text' }));
    
    return new Promise((resolve, reject) => {
      Papa.parse(csvData, {
        header: true,
        skipEmptyLines: true,
        complete: (results: any) => {
          if (results.errors.length > 0) {
            return reject(new Error("No se pudo analizar el archivo CSV. " + results.errors[0].message));
          }
          if (results.data.length === 0) {
            return reject(new Error("La hoja de cálculo está vacía o no tiene datos válidos."));
          }

          const headers = Object.keys(results.data[0]);
          const hasAllRequired = this.requiredHeaders.every(header => headers.includes(header));
          if (!hasAllRequired) {
            return reject(new Error("La estructura de la hoja de cálculo no coincide con el formato esperado. Por favor, revisa los encabezados de las columnas."));
          }
          
          const processedData: TicketData[] = results.data
            .filter((row: any) => row.Materia) // Ensure essential data exists
            .map((d: any) => ({
              ...d,
              Timestamp: new Date(d.Timestamp),
            }));
            
          resolve(processedData);
        },
        error: (err: any) => {
          reject(new Error("No se pudo cargar la hoja de cálculo. Asegúrate de que la URL sea correcta y que la hoja sea pública. " + err.message));
        }
      });
    });
  }
}