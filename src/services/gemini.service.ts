
import { Injectable } from '@angular/core';
import { GoogleGenAI } from "@google/genai";

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    // The API key is sourced from environment variables, as per the directive.
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      console.error("API_KEY environment variable not set.");
      throw new Error("API Key is missing.");
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateContent(userQuery: string, systemPrompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userQuery,
        config: {
          systemInstruction: systemPrompt,
        }
      });

      return response.text;
    } catch (error) {
      console.error("Error calling Gemini API:", error);
      throw new Error(`Failed to generate content: ${error}`);
    }
  }
}
