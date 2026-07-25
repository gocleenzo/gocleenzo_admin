// lib/whatsapp.ts
// Sends WhatsApp messages via WhatsApp Business API

const WA_TOKEN   = process.env.WHATSAPP_TOKEN
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_ID

async function sendWhatsAppMessage(to: string, message: string) {
  if (!WA_TOKEN || !WA_PHONE_ID) {
    console.warn('WhatsApp not configured — skipping message')
    return false
  }

  const phone = to.startsWith('+') ? to.slice(1) : to.startsWith('91') ? to : `91${to}`

  try {
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${WA_TOKEN}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to:                phone,
          type:              'text',
          text:              { body: message },
        }),
      }
    )
    return res.ok
  } catch (err) {
    console.error('WhatsApp error:', err)
    return false
  }
}

export async function whatsappBookingConfirmed(
  phone: string,
  customerName: string,
  serviceName: string,
  scheduledAt: string,
  otp: string
) {
  const date = new Date(scheduledAt).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  })
  const message = `Hi ${customerName}! 👋

Your *Cleenzo* booking is confirmed! ✅

🧹 *Service:* ${serviceName}
📅 *Scheduled:* ${date}
🔐 *Your OTP:* ${otp}

Share this OTP with the cleaner when they arrive to start the service.

For help: Reply to this message or call us.
Team Cleenzo 🏠`

  return sendWhatsAppMessage(phone, message)
}

export async function whatsappWorkerAssigned(
  phone: string,
  workerName: string,
  workerPhone: string,
  serviceName: string
) {
  const message = `Great news! 🎉

Your *${serviceName}* professional has been assigned.

👷 *Professional:* ${workerName}
📞 *Contact:* ${workerPhone}

They will arrive at your scheduled time. Your OTP is in your app.

Team Cleenzo 🏠`

  return sendWhatsAppMessage(phone, message)
}

export async function whatsappJobCompleted(
  phone: string,
  customerName: string,
  serviceName: string,
  amount: number
) {
  const message = `Hi ${customerName}! 

Your *${serviceName}* is complete! ✨

💰 *Amount:* ₹${amount}
⭐ Please rate your experience in the app.

Thank you for choosing Cleenzo! 🏠
Book again: cleenzo.in`

  return sendWhatsAppMessage(phone, message)
}