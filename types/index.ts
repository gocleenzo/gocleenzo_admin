export type BookingStatus =
  'pending' | 'accepted' | 'otp_verified' |
  'in_progress' | 'completed' | 'cancelled'

export type UserRole = 'customer' | 'worker' | 'owner'

export type Booking = {
  id: string
  customer_id: string
  worker_id: string | null
  service_id: string
  address_id: string
  status: BookingStatus
  scheduled_at: string
  base_price: number
  final_amount: number
  created_at: string
  services?: any
  addresses?: any
  customer?: any
  worker?: any
}