import { isSecretKey } from '@/lib/supabase'

const jwt = (role: string) => `x.${btoa(JSON.stringify({ role })).replace(/=+$/, '')}.y`

test('secret and service_role keys are rejected; publishable/anon keys are accepted', () => {
  expect(isSecretKey('sb_secret_abc')).toBe(true)
  expect(isSecretKey(jwt('service_role'))).toBe(true)
  expect(isSecretKey('sb_publishable_abc')).toBe(false)
  expect(isSecretKey(jwt('anon'))).toBe(false)
  expect(isSecretKey(undefined)).toBe(false)
})
