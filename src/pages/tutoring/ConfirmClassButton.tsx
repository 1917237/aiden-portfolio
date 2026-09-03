type Props = {
  state: 'idle' | 'loading' | 'success' | 'error'
  shake: boolean
  disabled?: boolean
  onClick: () => void
}

export function ConfirmClassButton({ state, shake, disabled, onClick }: Props) {
  const isSuccess = state === 'success'
  const isError = state === 'error'
  const isLoading = state === 'loading'

  return (
    <button
      type="button"
      disabled={disabled || isLoading || isSuccess}
      onClick={onClick}
      className={`inline-flex min-w-[7.5rem] items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-semibold transition-colors ${
        isSuccess
          ? 'bg-sage text-white'
          : isError
            ? 'border-2 border-red-400 bg-red-50 text-red-800'
            : 'bg-sage-deep text-white'
      } ${shake ? 'confirm-btn-shake' : ''} ${isSuccess ? 'confirm-btn-success' : ''} disabled:opacity-100`}
    >
      {isLoading ? (
        <span className="text-xs tracking-wide">Saving…</span>
      ) : isSuccess ? (
        <>
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              d="M4 10.5 8 14.5 16 6.5"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Confirmed</span>
        </>
      ) : (
        <span>Confirm class</span>
      )}
    </button>
  )
}
