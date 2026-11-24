/**
 * EstateOS Package 32 — typed frontend entry point for the pure calculator.
 * The calculation and formatting logic lives in `paymentCalculatorCore.mjs`
 * so the exact same code is exercised by the Node test runner.
 */

export {
  INSTALLMENT_FREQUENCIES,
  INSTALLMENT_MONTH_STEPS,
  addMonthsClamped,
  calculatePaymentPlan,
  formatAmortizationDate,
  formatAmortizationMoney,
  formatAmortizationPercent,
  buildAmortizationSummaryText,
  buildAmortizationWhatsAppMessage
} from './paymentCalculatorCore.mjs'

export type {
  AmortizationRow,
  BalloonInput,
  InstallmentFrequency,
  PaymentCalculatorLanguage,
  PaymentPlan,
  PaymentPlanInput,
  RateMode
} from './paymentCalculatorCore.mjs'

import {
  buildAmortizationWhatsAppMessage,
  calculatePaymentPlan
} from './paymentCalculatorCore.mjs'
import { buildWhatsAppUrl } from './whatsappCore.mjs'
import type { PaymentPlan, PaymentPlanInput } from './paymentCalculatorCore.mjs'

/** Opens a prefilled WhatsApp message; returns false when the phone or browser is unavailable. */
export function openAmortizationWhatsApp(options: {
  phone: string | null | undefined
  input: PaymentPlanInput
  language?: 'en' | 'ar'
}): boolean {
  const plan: PaymentPlan = calculatePaymentPlan(options.input)
  const message = buildAmortizationWhatsAppMessage(plan, options.language || plan.language, plan.currency)
  const url = buildWhatsAppUrl(options.phone, message)
  if (!url || typeof window === 'undefined') return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
