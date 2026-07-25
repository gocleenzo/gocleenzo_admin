// hooks/useRazorpay.ts
declare global {
  interface Window {
    Razorpay: any
  }
}

export function useRazorpay() {
  function loadScript(): Promise<boolean> {
    return new Promise(resolve => {
      if (document.getElementById('razorpay-script')) { resolve(true); return }
      const script = document.createElement('script')
      script.id  = 'razorpay-script'
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.onload  = () => resolve(true)
      script.onerror = () => resolve(false)
      document.body.appendChild(script)
    })
  }

  async function openRazorpay(options: Record<string, any>) {
    const loaded = await loadScript()
    if (!loaded) { alert('Payment failed to load. Check internet.'); return }
    const rzp = new window.Razorpay(options)
    rzp.open()
  }

  return { openRazorpay }
}