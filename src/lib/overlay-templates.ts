export type OverlayField = {
  key: string
  label: string
  type: 'text' | 'number' | 'textarea'
  placeholder?: string
  default: string | number
}

export type OverlayTemplate = {
  id: string
  name: string
  description: string
  file: string
  durationSeconds: number
  fields: OverlayField[]
}

export const TEMPLATES: OverlayTemplate[] = [
  {
    id: 'stat',
    name: 'Stat / Prozent-Zahl',
    description: 'Große Zahl mit Label und Quelle — ideal für "94% der Tierärzte empfehlen…"',
    file: '/overlays/stat.html',
    durationSeconds: 6,
    fields: [
      { key: 'target', label: 'Zahl', type: 'number', default: 94 },
      { key: 'suffix', label: 'Zusatz (z.B. %)', type: 'text', default: '%' },
      { key: 'line1', label: 'Hauptzeile', type: 'text', default: 'der Tierärzte empfehlen' },
      { key: 'line2', label: 'Quelle', type: 'text', default: 'Quelle: Bundesverband der Tierärzte 2025' },
    ],
  },
  {
    id: 'testimonial',
    name: 'Testimonial-Zitat',
    description: 'Zitat mit Name und Rolle — word-by-word Animation',
    file: '/overlays/testimonial.html',
    durationSeconds: 7,
    fields: [
      { key: 'quote', label: 'Zitat', type: 'textarea', default: 'Der Juckreiz ist so gut wie weg. Kein Pfotenlecken mehr. Ihr Fell sieht fantastisch aus.' },
      { key: 'name', label: 'Name', type: 'text', default: 'Dr. Maria Schmidt' },
      { key: 'role', label: 'Rolle / Titel', type: 'text', default: 'Tierärztin, 12 Jahre Erfahrung' },
    ],
  },
  {
    id: 'text',
    name: 'Text-Callout',
    description: 'Pill-Badge mit Überschrift — für Key-Messages und Preispunkte',
    file: '/overlays/text.html',
    durationSeconds: 5.5,
    fields: [
      { key: 'pill', label: 'Badge-Text', type: 'text', default: 'WICHTIG' },
      { key: 'headline', label: 'Überschrift', type: 'textarea', default: 'Nur unter einem Euro Strom im Monat.' },
    ],
  },
]

export function getTemplate(id: string): OverlayTemplate | undefined {
  return TEMPLATES.find(t => t.id === id)
}
