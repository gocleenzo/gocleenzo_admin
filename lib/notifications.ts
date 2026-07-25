// lib/notifications.ts
// Call these functions from API routes to notify users on booking events

export async function notifyCustomerBookingConfirmed(
  customerId: string,
  serviceName: string,
  scheduledAt: string
) {
  await sendNotification(customerId, {
    title: '✅ Booking Confirmed!',
    body:  `Your ${serviceName} is booked. We are finding a professional for you.`,
    data:  { type: 'booking_confirmed' },
  })
}

export async function notifyCustomerWorkerAssigned(
  customerId: string,
  workerName: string,
  serviceName: string
) {
  await sendNotification(customerId, {
    title: '👷 Professional Assigned!',
    body:  `${workerName} will be doing your ${serviceName}. Check your OTP.`,
    data:  { type: 'worker_assigned' },
  })
}

export async function notifyCustomerJobCompleted(
  customerId: string,
  serviceName: string
) {
  await sendNotification(customerId, {
    title: '🎉 Service Completed!',
    body:  `Your ${serviceName} is done. Please rate your experience.`,
    data:  { type: 'job_completed' },
  })
}

export async function notifyWorkerNewJob(
  workerId: string,
  serviceName: string,
  area: string,
  amount: number
) {
  await sendNotification(workerId, {
    title: '🔔 New Job Available!',
    body:  `${serviceName} in ${area} — ₹${amount}. Accept now!`,
    data:  { type: 'new_job' },
  })
}

export async function notifyWorkerJobCancelled(
  workerId: string,
  serviceName: string
) {
  await sendNotification(workerId, {
    title: '❌ Job Cancelled',
    body:  `The ${serviceName} booking has been cancelled by the customer.`,
    data:  { type: 'job_cancelled' },
  })
}

// internal helper
async function sendNotification(
  userId: string,
  payload: { title: string; body: string; data?: Record<string, string> }
) {
  try {
    await fetch('/api/notifications/send', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, ...payload }),
    })
  } catch (err) {
    console.error('Notification failed:', err)
  }
}