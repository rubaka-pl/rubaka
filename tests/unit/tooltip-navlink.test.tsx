import { render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink } from 'react-router'
import { Tooltip, TooltipProvider } from '@/components/ui/overlays'

const link = (
  <NavLink to="/anime" className={({ isActive }) => (isActive ? 'nav-active' : 'nav-idle')}>Anime</NavLink>
)

test('NavLink class function survives a tooltip wrapper (collapsed sidebar)', () => {
  render(
    <MemoryRouter initialEntries={['/anime']}>
      <TooltipProvider>
        <Tooltip content="Anime"><span className="block">{link}</span></Tooltip>
      </TooltipProvider>
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Anime' }).className).toBe('nav-active')
})

test('regression: putting the NavLink directly under the trigger breaks its className', () => {
  render(
    <MemoryRouter initialEntries={['/anime']}>
      <TooltipProvider>
        <Tooltip content="Anime">{link}</Tooltip>
      </TooltipProvider>
    </MemoryRouter>,
  )
  expect(screen.getByRole('link', { name: 'Anime' }).className).not.toBe('nav-active')
})
