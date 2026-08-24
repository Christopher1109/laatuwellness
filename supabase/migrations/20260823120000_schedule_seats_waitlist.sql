-- Admin schedule calendar: seat map + waitlist support for bookings.
-- Status values used across the app going forward:
--   'reservada'   -> confirmed booking, credit already spent
--   'lista_espera'-> waitlisted, credit already spent, refunded if never promoted
--   'check_in'    -> attended (checked in at the studio)
--   'no_asistio'  -> reserved but did not attend (credit stays spent)
--   'cancelada'   -> booking cancelled, credit refunded

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS seat_number int;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS waitlisted_at timestamptz;

CREATE INDEX IF NOT EXISTS bookings_class_status_idx ON public.bookings (class_id, status);
CREATE INDEX IF NOT EXISTS bookings_class_seat_idx ON public.bookings (class_id, seat_number);

-- A seat can only be held once per class among active bookings.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_class_seat_unique
  ON public.bookings (class_id, seat_number)
  WHERE seat_number IS NOT NULL AND status IN ('reservada', 'check_in');

-- Refunds the credit for a booking (used on cancel, or when a waitlist spot
-- never converts). Idempotent-ish: only refunds tokens_spent once by relying
-- on the caller to only invoke this on a valid state transition.
CREATE OR REPLACE FUNCTION public.refund_booking_credit(p_booking_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_booking.tokens_spent > 0 THEN
    INSERT INTO public.token_ledger (user_id, delta, reason, created_by)
    VALUES (v_booking.user_id, v_booking.tokens_spent, p_reason, auth.uid());
  END IF;
END;
$$;
