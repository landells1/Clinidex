export type Category =
  | 'audit_qip'
  | 'teaching'
  | 'conference'
  | 'publication'
  | 'leadership'
  | 'prize'
  | 'procedure'
  | 'reflection'
  | 'custom'

export const CATEGORIES: { value: Category; label: string; short: string }[] = [
  { value: 'audit_qip',   label: 'Audit & QIP',               short: 'Audit' },
  { value: 'teaching',    label: 'Teaching & Presentations',   short: 'Teaching' },
  { value: 'conference',  label: 'Conferences & Courses',      short: 'Conference' },
  { value: 'publication', label: 'Publications & Research',    short: 'Publication' },
  { value: 'leadership',  label: 'Leadership & Societies',     short: 'Leadership' },
  { value: 'prize',       label: 'Prizes & Awards',            short: 'Prize' },
  { value: 'procedure',   label: 'Procedures & Clinical Skills', short: 'Procedure' },
  { value: 'reflection',  label: 'Reflections & CBDs/DOPs',   short: 'Reflection' },
  { value: 'custom',      label: 'Custom',                     short: 'Custom' },
]

export const CATEGORY_COLOURS: Record<Category, string> = {
  audit_qip:   'bg-blue-500/15 text-blue-400 border-blue-500/20',
  teaching:    'bg-purple-500/15 text-purple-400 border-purple-500/20',
  conference:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  publication: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  leadership:  'bg-pink-500/15 text-pink-400 border-pink-500/20',
  prize:       'bg-amber-500/15 text-amber-400 border-amber-500/20',
  procedure:   'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  reflection:  'bg-green-500/15 text-green-400 border-green-500/20',
  custom:      'bg-[rgba(245,245,242,0.08)] text-[rgba(245,245,242,0.55)] border-white/[0.08]',
}

export type PortfolioEntry = {
  id: string
  user_id: string
  category: Category
  title: string
  date: string
  specialty_tags: string[]
  notes: string | null
  created_at: string
  updated_at: string

  // Audit & QIP
  audit_type?: string | null
  audit_role?: string | null
  audit_cycle_stage?: string | null
  audit_trust?: string | null
  audit_outcome?: string | null
  audit_presented?: boolean | null

  // Teaching & Presentations
  teaching_type?: string | null
  teaching_audience?: string | null
  teaching_setting?: string | null
  teaching_event?: string | null
  teaching_invited?: boolean | null

  // Conferences & Courses
  conf_type?: string | null
  conf_event_name?: string | null
  conf_attendance?: string | null
  conf_level?: string | null
  conf_cpd_hours?: number | null
  conf_certificate?: boolean | null

  // Publications & Research
  pub_type?: string | null
  pub_journal?: string | null
  pub_authors?: string | null
  pub_status?: string | null
  pub_doi?: string | null

  // Leadership & Societies
  leader_role?: string | null
  leader_organisation?: string | null
  leader_start_date?: string | null
  leader_end_date?: string | null
  leader_ongoing?: boolean | null

  // Prizes & Awards
  prize_body?: string | null
  prize_level?: string | null
  prize_description?: string | null

  // Procedures & Clinical Skills
  proc_name?: string | null
  proc_setting?: string | null
  proc_supervision?: string | null
  proc_count?: number | null

  // Reflections & CBDs/DOPs
  refl_type?: string | null
  refl_clinical_context?: string | null
  refl_supervisor?: string | null
  refl_free_text?: string | null

  // Custom
  custom_free_text?: string | null
}

export type NewPortfolioEntry = Omit<PortfolioEntry, 'id' | 'user_id' | 'created_at' | 'updated_at'>
