'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setLoading(true)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/onboarding`,
      },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // Profile row is created automatically by the DB trigger
    router.push('/onboarding')
    router.refresh()
  }

  return (
    <div className="bg-[#141416] border border-white/[0.08] rounded-2xl p-8">
      <h1 className="text-xl font-semibold text-[#F5F5F2] mb-1">Create your account</h1>
      <p className="text-sm text-[rgba(245,245,242,0.55)] mb-6">
        Free for 6 months. No credit card required.
      </p>

      <form onSubmit={handleSignup} className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[rgba(245,245,242,0.55)] mb-1.5 uppercase tracking-wide">
            Email address
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full bg-[#0B0B0C] border border-white/[0.08] rounded-lg px-3.5 py-2.5 text-sm text-[#F5F5F2] placeholder-[rgba(245,245,242,0.25)] focus:outline-none focus:border-[#1D9E75] transition-colors"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[rgba(245,245,242,0.55)] mb-1.5 uppercase tracking-wide">
            Password
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-[#0B0B0C] border border-white/[0.08] rounded-lg px-3.5 py-2.5 text-sm text-[#F5F5F2] placeholder-[rgba(245,245,242,0.25)] focus:outline-none focus:border-[#1D9E75] transition-colors"
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[rgba(245,245,242,0.55)] mb-1.5 uppercase tracking-wide">
            Confirm password
          </label>
          <input
            type="password"
            required
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className="w-full bg-[#0B0B0C] border border-white/[0.08] rounded-lg px-3.5 py-2.5 text-sm text-[#F5F5F2] placeholder-[rgba(245,245,242,0.25)] focus:outline-none focus:border-[#1D9E75] transition-colors"
            placeholder="••••••••"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3.5 py-2.5 text-sm text-red-400">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-[#1D9E75] hover:bg-[#178060] disabled:opacity-50 disabled:cursor-not-allowed text-[#0B0B0C] font-semibold rounded-lg py-2.5 text-sm transition-colors"
        >
          {loading ? 'Creating account…' : 'Create account →'}
        </button>
      </form>

      <p className="text-center text-xs text-[rgba(245,245,242,0.25)] mt-5 leading-relaxed">
        By signing up you agree to our{' '}
        <span className="text-[rgba(245,245,242,0.45)]">Terms of Service</span> and{' '}
        <span className="text-[rgba(245,245,242,0.45)]">Privacy Policy</span>.
      </p>

      <p className="text-center text-sm text-[rgba(245,245,242,0.35)] mt-4">
        Already have an account?{' '}
        <Link href="/login" className="text-[#1D9E75] hover:text-[#1D9E75]/80 transition-colors font-medium">
          Log in
        </Link>
      </p>
    </div>
  )
}
