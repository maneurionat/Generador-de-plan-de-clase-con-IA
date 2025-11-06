import { Component, ChangeDetectionStrategy, signal, computed, effect, inject, ElementRef, viewChild, WritableSignal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DataService } from './services/data.service';
import { GeminiService } from './services/gemini.service';
import { TicketData, FilterOptions } from './models/ticket-data.model';

// Declare external libraries loaded via CDN
declare var d3: any;
declare var marked: any;
declare var html2pdf: any;

interface PriorityStudent {
  name: string;
  materia: string;
  paralelo: string;
  fecha: string;
  razon: string;
  badgeColor: string;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule]
})
export class AppComponent {
  dataService = inject(DataService);
  private geminiService = inject(GeminiService);

  // --- UI State Signals ---
  sheetUrl = signal('');
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  dataLoaded = signal(false);
  
  // --- Filter State Signals ---
  // UI-bound filters
  startDate = signal('');
  endDate = signal('');
  selectedMateria = signal('');
  selectedParalelo = signal('');

  // Applied filters for computation
  appliedStartDate = signal('');
  appliedEndDate = signal('');
  appliedSelectedMateria = signal('');
  appliedSelectedParalelo = signal('');

  // --- Data Signals ---
  allData = signal<TicketData[]>([]);
  filterOptions = computed<FilterOptions>(() => {
    const data = this.allData();
    const materias = [...new Set(data.map(d => d.Materia))].sort();
    const paralelos = [...new Set(data.map(d => d.Paralelo))].sort();
    return { materias, paralelos };
  });

  filteredData = computed(() => {
    const data = this.allData();
    const start = this.appliedStartDate();
    const end = this.appliedEndDate();
    const materia = this.appliedSelectedMateria();
    const paralelo = this.appliedSelectedParalelo();

    if (!data.length) return [];

    return data.filter(row => {
      const rowDate = row.Timestamp;
      const isAfterStartDate = !start || (rowDate && rowDate >= new Date(start));
      const endDateTime = end ? new Date(end) : null;
      if (endDateTime) endDateTime.setHours(23, 59, 59, 999);
      const isBeforeEndDate = !end || (rowDate && rowDate <= endDateTime);
      const isCorrectMateria = !materia || row.Materia === materia;
      const isCorrectParalelo = !paralelo || row.Paralelo === paralelo;

      return isAfterStartDate && isBeforeEndDate && isCorrectMateria && isCorrectParalelo;
    });
  });

  // --- Summary Card Signals ---
  totalResponses = computed(() => this.filteredData().length);
  averageScore = computed(() => {
    const scores = this.filteredData()
      .map(d => parseInt(d[this.dataService.scoreIndex]))
      .filter(s => !isNaN(s) && s >= 1 && s <= 10);
    return scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : 'N/A';
  });
  averageComprehension = computed(() => {
    const comprehensionMap: { [key: string]: number } = {
      "¡Entendido! - Lo domino y podría explicarlo.": 3,
      "Más o menos. - Entendí la idea general, pero tengo dudas.": 2,
      "No entendí casi nada. - Me siento bastante perdido/a.": 1,
    };
    const scores = this.filteredData()
      .map(d => comprehensionMap[d[this.dataService.comprehensionIndex]?.trim()])
      .filter(Boolean);
    if (!scores.length) return 'N/A';
    
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg >= 2.7) return "¡Excelente Comprensión!";
    if (avg >= 2.0) return "Buena (Pocas Dudas)";
    if (avg >= 1.0) return "Media (Necesita Revisión)";
    return "Baja (Refuerzo Urgente)";
  });

  // --- AI Summary Signals ---
  learnings = this.createSummarySignal();
  confused = this.createSummarySignal();
  questions = this.createSummarySignal();
  suggestions = this.createSummarySignal();
  lessonPlan = this.createSummarySignal();
  studentGuide = this.createSummarySignal();

  // Placeholders for AI summary sections
  learningsPlaceholder = `<p class="text-gray-500 italic text-sm">Haz clic para generar un resumen de los aprendizajes clave.</p>`;
  confusedPlaceholder = `<p class="text-gray-500 italic text-sm">Haz clic para identificar las áreas de confusión.</p>`;
  questionsPlaceholder = `<p class="text-gray-500 italic text-sm">Haz clic para agrupar las preguntas de los estudiantes.</p>`;
  suggestionsPlaceholder = `<p class="text-gray-500 italic text-sm">Haz clic para resumir las sugerencias de mejora.</p>`;
  lessonPlanPlaceholder = `<p class="text-gray-500 italic text-sm">El plan de clase generado por IA aparecerá aquí.</p>`;
  studentGuidePlaceholder = `<p class="text-gray-500 italic text-sm">La guía de estudio y refuerzo aparecerá aquí.</p>`;
  
  // --- UI Toggles ---
  isPriorityListVisible = signal(false);
  isRawDataVisible = signal(false);
  isModalVisible = signal(false);

  // --- Modal Form Data ---
  modalNextTopic = signal('');
  modalNumStudents = signal('');
  modalClassDuration = signal('');
  modalMateriaOutcome = signal('');
  modalUnitOutcome = signal('');
  modalClassProduct = signal('');
  modalErrorMessage = signal<string|null>(null);
  
  // --- D3 Chart Elements ---
  comprehensionChart = viewChild<ElementRef>('comprehensionChart');
  engagementChart = viewChild<ElementRef>('engagementChart');
  scoreChart = viewChild<ElementRef>('scoreChart');

  constructor() {
    effect(() => {
      // Re-render charts whenever filtered data or chart elements are available
      const data = this.filteredData();
      const compChartEl = this.comprehensionChart();
      const engChartEl = this.engagementChart();
      const scoreChartEl = this.scoreChart();
  
      if (this.dataLoaded() && data.length > 0 && compChartEl && engChartEl && scoreChartEl) {
        this.renderCharts(data);
      } else if (this.dataLoaded() && (compChartEl || engChartEl || scoreChartEl)) {
        // Handle case with filters resulting in no data
        this.clearCharts();
      }
    });
  }
  
  // --- Data Loading and Filtering ---
  async loadData() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.dataLoaded.set(false);

    try {
      const data = await this.dataService.loadDataFromSheet(this.sheetUrl());
      this.allData.set(data);
      this.applyFilters();
      this.dataLoaded.set(true);
    } catch (error: any) {
      this.errorMessage.set(error.message);
      this.allData.set([]);
    } finally {
      this.isLoading.set(false);
    }
  }

  onUrlInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.sheetUrl.set(input.value);
  }

  onFilterChange(event: Event, filterType: 'startDate' | 'endDate' | 'materia' | 'paralelo') {
      const value = (event.target as HTMLInputElement).value;
      if(filterType === 'startDate') this.startDate.set(value);
      if(filterType === 'endDate') this.endDate.set(value);
      if(filterType === 'materia') this.selectedMateria.set(value);
      if(filterType === 'paralelo') this.selectedParalelo.set(value);
  }

  applyFilters() {
    this.appliedStartDate.set(this.startDate());
    this.appliedEndDate.set(this.endDate());
    this.appliedSelectedMateria.set(this.selectedMateria());
    this.appliedSelectedParalelo.set(this.selectedParalelo());

    // Reset summaries when filters are applied
    this.resetAISummaries();
    this.resetLessonPlan();
  }

  private resetAISummaries() {
    this.learnings.set({ content: null, loading: false });
    this.confused.set({ content: null, loading: false });
    this.questions.set({ content: null, loading: false });
    this.suggestions.set({ content: null, loading: false });
  }

  private resetLessonPlan() {
    this.lessonPlan.set({ content: null, loading: false });
    this.studentGuide.set({ content: null, loading: false });
  }

  // --- AI Generation Methods ---
  private createSummarySignal() {
    return signal({ loading: false, content: null as string | null });
  }

  generateSummary(type: 'learnings' | 'confused' | 'questions' | 'suggestions') {
      const data = this.filteredData();
      if (!data.length) return;

      let responses: string[], systemPrompt: string, stateSignal: WritableSignal<any>, dataIndex: string;

      switch(type) {
        case 'learnings':
          dataIndex = this.dataService.learningIndex;
          systemPrompt = "Eres un asistente de análisis educativo. Tu tarea es leer las respuestas de los estudiantes sobre su aprendizaje más importante de la clase y generar un resumen conciso y profesional, identificando los 3 a 5 temas o ideas principales mencionados. Formatea el resultado usando Markdown con una lista numerada de los puntos clave.";
          stateSignal = this.learnings;
          break;
        case 'confused':
          dataIndex = this.dataService.confusedIndex;
          systemPrompt = "Eres un asistente de análisis educativo. Tu tarea es leer las respuestas de los estudiantes sobre los puntos más confusos de la clase y generar un resumen conciso, identificando los 3 a 5 temas principales que causaron confusión. Prioriza las áreas de refuerzo más urgentes. Formatea el resultado usando Markdown con una lista numerada.";
          stateSignal = this.confused;
          break;
        case 'questions':
          dataIndex = this.dataService.questionIndex;
          systemPrompt = "Eres un asistente educativo. Tu tarea es leer las preguntas de los estudiantes para la siguiente clase y generar un resumen conciso, agrupando las 3 a 5 preguntas o temas más solicitados para abordar al inicio de la próxima sesión. Formatea el resultado usando Markdown con una lista numerada.";
          stateSignal = this.questions;
          break;
        case 'suggestions':
          dataIndex = this.dataService.suggestionIndex;
          systemPrompt = "Eres un analista de feedback. Tu tarea es leer las sugerencias de los estudiantes sobre cómo el docente puede ayudarlos a comprender mejor el tema y generar un resumen conciso de las 3 a 5 peticiones principales (ej: 'más ejemplos prácticos', 'más tiempo de laboratorio'). Formatea el resultado usando Markdown con una lista numerada.";
          stateSignal = this.suggestions;
          break;
      }
      
      responses = data.map(d => d[dataIndex]?.trim()).filter(text => text && text !== '.' && !['no', 'ninguna', 'ninguno', 'nada'].includes(text.toLowerCase()));
      if (!responses.length) {
        stateSignal.set({ loading: false, content: `<p class="text-gray-500 font-semibold text-sm">Los estudiantes no proporcionaron respuestas significativas en este filtro.</p>` });
        return;
      }
      
      const userQuery = `Contexto: Materia: ${this.selectedMateria() || 'Todas'}. Respuestas a analizar:\n\n${responses.join('\n---\n')}`;
      this.callGemini(userQuery, systemPrompt, stateSignal);
  }

  async generateLessonPlan() {
    this.modalErrorMessage.set(null);
    const confusedText = this.confused().content || 'No hay puntos confusos destacados por la IA (Genera el resumen de confusión si es necesario)';
    const questionsText = this.questions().content || 'No hay preguntas pendientes destacadas por la IA (Genera el resumen de preguntas si es necesario)';
    
    const requiredFields = [this.modalNextTopic(), this.modalNumStudents(), this.modalClassDuration(), this.modalMateriaOutcome(), this.modalUnitOutcome()];
    if(requiredFields.some(field => !field)) {
      this.modalErrorMessage.set('Por favor, rellena todos los campos requeridos (*).');
      return;
    }
    this.isModalVisible.set(false);

    const systemPrompt = `Eres un diseñador instruccional experto. Crea un plan de clase híbrido y estructurado para una clase de ${this.modalClassDuration()} minutos. El objetivo es: 1) Reforzar los 'Puntos Confusos' y responder las 'Preguntas Pendientes' de la clase anterior, y 2) Introducir el nuevo tema: "${this.modalNextTopic()}". El plan debe ser profesional y práctico. Estructura el resultado usando Markdown con estos 4 pasos principales, ajustando los tiempos para sumar ${this.modalClassDuration()} minutos: ### 1. Inicio y Revisión, ### 2. Desarrollo del Nuevo Tema, ### 3. Actividad de Aplicación y Preguntas, ### 4. Cierre y Próximos Pasos.`;
    const userQuery = `**Materia:** ${this.selectedMateria()}. **Estudiantes:** ${this.modalNumStudents()}.
    **Nuevo Tema:** ${this.modalNextTopic()}
    **Resultados de Aprendizaje:**
    - Materia: ${this.modalMateriaOutcome()}
    - Unidad: ${this.modalUnitOutcome()}
    - Producto de la Clase (Opcional): ${this.modalClassProduct() || 'Ninguno'}
    **Feedback de Estudiantes a Abordar:**
    1. Puntos Confusos: ${confusedText}
    2. Preguntas Pendientes: ${questionsText}
    **Instrucción Final:** Genera un plan de clase detallado en 4 pasos.`;
    
    this.callGemini(userQuery, systemPrompt, this.lessonPlan);
  }

  generateStudentGuide() {
    const plan = this.lessonPlan().content;
    if (!plan || this.lessonPlan().loading) return;

    const systemPrompt = `Eres un coach de estudio. Tu tarea es tomar un Plan de Clase y transformarlo en una Guía de Estudio y Refuerzo concisa y motivadora para los estudiantes. El tono debe ser alentador, directo y orientado a la acción. Estructura el resultado usando Markdown con 3 secciones principales: ### 1. Nuestro Objetivo de Refuerzo, ### 2. Pasos Clave de Refuerzo, ### 3. Checklist de Preparación.`;
    const userQuery = `**Materia:** ${this.selectedMateria()}. **Plan de Clase a transformar:**\n\n${plan}\n\n**Instrucción Final:** Genera la Guía de Estudio para un estudiante basada en el plan de clase proporcionado.`;

    this.callGemini(userQuery, systemPrompt, this.studentGuide);
  }

  private async callGemini(userQuery: string, systemPrompt: string, stateSignal: WritableSignal<any>) {
    stateSignal.set({ loading: true, content: null });
    try {
      const result = await this.geminiService.generateContent(userQuery, systemPrompt);
      stateSignal.set({ loading: false, content: marked.parse(result) });
    } catch (error: any) {
      stateSignal.set({ loading: false, content: `<p class="text-red-600 font-semibold">Error: ${error.message}</p>` });
    }
  }

  // --- UI Toggles ---
  togglePriorityList() { this.isPriorityListVisible.update(v => !v); }
  toggleRawData() { this.isRawDataVisible.update(v => !v); }
  openModal() { this.isModalVisible.set(true); }
  closeModal() { this.isModalVisible.set(false); }

  // --- PDF Export ---
  exportToPDF(elementId: string, filename: string) {
    const element = document.getElementById(elementId);
    if (!element) return;
    
    const clone = element.cloneNode(true) as HTMLElement;
    clone.style.padding = '30px';
    clone.style.backgroundColor = '#ffffff';

    html2pdf().from(clone).set({
      margin: 1,
      filename: `${filename}_${new Date().toISOString().slice(0, 10)}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, logging: true, dpi: 192, letterRendering: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    }).save();
  }

  // --- Priority Student List ---
  priorityStudents = computed<PriorityStudent[]>(() => {
    const comprehensionPriorityValue = "No entendí casi nada. - Me siento bastante perdido/a.";
    const comprehensionLabels: { [key: string]: string } = {
        "¡Entendido! - Lo domino y podría explicarlo.": "Dominado",
        "Más o menos. - Entendí la idea general, pero tengo dudas.": "Dudas/Idea General",
        "No entendí casi nada. - Me siento bastante perdido/a.": "Perdido/a",
    };

    return this.filteredData()
      .filter(d => {
        const score = parseInt(d[this.dataService.scoreIndex]);
        return (!isNaN(score) && score <= 7) || d[this.dataService.comprehensionIndex]?.trim() === comprehensionPriorityValue;
      })
      .map(d => {
        const score = parseInt(d[this.dataService.scoreIndex]);
        const lowScore = !isNaN(score) && score <= 7;
        const lowComprehension = d[this.dataService.comprehensionIndex]?.trim() === comprehensionPriorityValue;
        
        let reason = '';
        if (lowComprehension && lowScore) {
            reason = `Comprensión Baja y Satisfacción Baja (${score}/10)`;
        } else if (lowComprehension) {
            reason = `Comprensión Baja: ${comprehensionLabels[d[this.dataService.comprehensionIndex]?.trim()] || 'N/A'}`;
        } else if (lowScore) {
            reason = `Satisfacción Baja (${score}/10)`;
        }

        return {
          name: d['Email Address']?.split('@')[0].replace(/\./g, ' ').toUpperCase() || 'Desconocido',
          materia: d.Materia,
          paralelo: d.Paralelo,
          fecha: d.Timestamp.toLocaleDateString('es-ES'),
          razon: reason,
          badgeColor: (lowComprehension && lowScore) ? 'bg-red-700' : (lowComprehension ? 'bg-red-500' : 'bg-yellow-600')
        };
      });
  });
  
  formatCell(value: any): string {
    if (value instanceof Date) {
      return value.toLocaleDateString('es-ES');
    }
    return String(value);
  }

  private clearCharts() {
    const compChartEl = this.comprehensionChart()?.nativeElement;
    const engChartEl = this.engagementChart()?.nativeElement;
    const scoreChartEl = this.scoreChart()?.nativeElement;
    const noDataMsg = '<p class="text-gray-500 py-4 text-center">No hay datos para mostrar con los filtros seleccionados.</p>';
    if (compChartEl) compChartEl.innerHTML = noDataMsg;
    if (engChartEl) engChartEl.innerHTML = noDataMsg;
    if (scoreChartEl) scoreChartEl.innerHTML = noDataMsg;
  }

  private renderCharts(data: TicketData[]) {
    const compChartEl = this.comprehensionChart()!.nativeElement;
    const engChartEl = this.engagementChart()!.nativeElement;
    const scoreChartEl = this.scoreChart()!.nativeElement;
    
    const comprehensionLabels = {
        "¡Entendido! - Lo domino y podría explicarlo.": "¡Dominado!",
        "Más o menos. - Entendí la idea general, pero tengo dudas.": "Dudas/Idea General",
        "No entendí casi nada. - Me siento bastante perdido/a.": "Perdido/a",
    };
    const engagementLabels = {
        "Muy Comprometido/a: Me esforcé al máximo.": "Máximo Esfuerzo",
        "Comprometido/a: Sé que podría haberme esforzado un poco más.": "Podría Esforzarme Más",
        "Poco Comprometido/a: Podría haberme esforzado mucho más.": "Esfuerzo Bajo",
    };

    // --- Process data for charts ---
    const comprehensionData = this.groupData(data, this.dataService.comprehensionIndex, comprehensionLabels);
    const engagementData = this.groupData(data, this.dataService.engagementIndex, engagementLabels);
    const scoreData = Array.from(d3.rollup(data, (v: any[]) => v.length, (d: TicketData) => parseInt(d[this.dataService.scoreIndex])))
        .map(([category, count]) => ({ category: category.toString(), count }))
        .filter(d => !isNaN(parseInt(d.category)))
        .sort((a, b) => parseInt(a.category) - parseInt(b.category));
    
    // --- Draw charts ---
    this.drawPieChart(compChartEl, comprehensionData);
    this.drawPieChart(engChartEl, engagementData);
    this.drawBarChart(scoreChartEl, scoreData);
  }

  private groupData(data: TicketData[], key: string, labels: { [key: string]: string }): { category: string, count: number }[] {
    return Array.from(d3.rollup(data, (v: any[]) => v.length, (d: TicketData) => labels[d[key]?.trim()] || d[key]?.trim()))
      .map(([category, count]) => ({ category, count }))
      .filter(d => d.category);
  }

  private drawPieChart(element: HTMLElement, data: { category: string, count: number }[]) {
      d3.select(element).selectAll('*').remove();
      if (!data.length) {
        d3.select(element).html('<p class="text-gray-500 py-4">No hay datos válidos para este gráfico.</p>');
        return;
      }
      
      const width = element.getBoundingClientRect().width || 500;
      const height = 320; // h-80
      const radius = Math.min(width, height) / 2 - 20;
      const legendWidth = 200;

      const svg = d3.select(element).append("svg")
          .attr("width", width)
          .attr("height", height)
          .append("g")
          .attr("transform", `translate(${width / 2 - (legendWidth / 2) + 20}, ${height / 2})`);

      const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
      const pie = d3.pie().sort(null).value((d: any) => d.count);
      const arc = d3.arc().innerRadius(0).outerRadius(radius);
      
      const arcs = svg.selectAll(".arc").data(pie(data)).enter().append("g").attr("class", "arc");
      arcs.append("path").attr("d", arc).attr("fill", (d: any) => colorScale(d.data.category));

      // Legend
      const legendContainer = d3.select(element).append("div")
          .attr("class", "absolute top-0 right-0 p-4 rounded-lg flex flex-col justify-center")
          .style("width", `${legendWidth}px`).style("height", "100%");
      data.forEach(d => {
          const percentage = (d.count / d3.sum(data, (item: any) => item.count)) * 100;
          legendContainer.append("div").attr("class", "legend-item")
              .html(`<div class="legend-color" style="background-color: ${colorScale(d.category)}"></div><span class="font-normal text-gray-700">${d.category}:</span> <span class="font-semibold text-purple-700">${percentage.toFixed(1)}%</span>`);
      });
  }

  private drawBarChart(element: HTMLElement, data: { category: string, count: number }[]) {
      d3.select(element).selectAll('*').remove();
      if (!data.length) {
        d3.select(element).html('<p class="text-gray-500 py-4">No hay datos válidos para este gráfico.</p>');
        return;
      }
      
      const margin = { top: 20, right: 20, bottom: 30, left: 40 };
      const width = element.getBoundingClientRect().width - margin.left - margin.right;
      const height = 320 - margin.top - margin.bottom; // h-80
      
      const svg = d3.select(element).append("svg")
          .attr("width", width + margin.left + margin.right)
          .attr("height", height + margin.top + margin.bottom)
          .append("g")
          .attr("transform", `translate(${margin.left},${margin.top})`);
          
      const x = d3.scaleBand().range([0, width]).padding(0.1).domain(data.map(d => d.category));
      const y = d3.scaleLinear().range([height, 0]).domain([0, d3.max(data, (d: any) => d.count)]);
      
      svg.append("g").attr("transform", `translate(0,${height})`).call(d3.axisBottom(x));
      svg.append("g").call(d3.axisLeft(y).ticks(Math.min(5, d3.max(data, (d:any) => d.count))).tickFormat(d3.format("d")));
      
      const barColor = d3.scaleLinear().domain([1, 10]).range(["#f56565", "#48bb78"]);
      
      svg.selectAll(".bar").data(data).enter().append("rect")
          .attr("class", "bar")
          .attr("x", (d: any) => x(d.category) as number)
          .attr("width", x.bandwidth())
          .attr("y", y(0))
          .attr("height", 0)
          .attr("fill", (d: any) => barColor(parseInt(d.category)))
          .transition()
          .duration(800)
          .delay((d, i) => i * 50)
          .attr("y", (d: any) => y(d.count))
          .attr("height", (d: any) => height - y(d.count));

      svg.selectAll(".bar-label")
        .data(data)
        .enter().append("text")
        .attr("class", "bar-label")
        .attr("x", (d: any) => (x(d.category) as number) + x.bandwidth() / 2)
        .attr("y", (d: any) => y(d.count) - 5)
        .attr("text-anchor", "middle")
        .style("font-size", "10px")
        .style("font-weight", "bold")
        .text((d: any) => d.count)
        .style("opacity", 0)
        .transition()
        .duration(800)
        .delay((d, i) => i * 50 + 400)
        .style("opacity", 1);
  }

}