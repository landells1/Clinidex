import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name')
    .eq('id', user!.id)
    .single()

  const firstName = profile?.first_name || 'there'

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#F5F5F2] tracking-tight">
          Good morning, {firstName}
        </h1>
        <p className="text-sm text-[rgba(245,245,242,0.45)] mt-1">
          Here&apos;s your portfolio at a glance.
        </p>
      </div>

      {/* Coming in Stage 4 */}
      <div className="flex items-center justify-center h-64 border border-dashed border-white/[0.08] rounded-2xl">
        <div className="text-center">
          <p className="text-[rgba(245,245,242,0.35)] text-sm">Dashboard widgets coming in Stage 4</p>
          <p className="text-[rgba(245,245,242,0.2)] text-xs mt-1">Portfolio, Cases, and Export are ready to use</p>
        </div>
      </div>
    </div>
  )
}
