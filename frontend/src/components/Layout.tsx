import { Anchor, Box, Container, Group } from '@mantine/core'
import { Link, Outlet, useLocation } from 'react-router'

const navItems = [
  { to: '/book', label: 'Бронирование' },
  { to: '/owner', label: 'Страница владельца' },
]

export function Layout() {
  const { pathname } = useLocation()

  return (
    <>
      <Box
        component="header"
        py="sm"
        style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}
      >
        <Container size="sm">
          <Group justify="space-between" gap="md" wrap="wrap">
            <Anchor component={Link} to="/" fw={700} c="inherit" underline="never">
              Календарь звонков
            </Anchor>

            <Group gap="lg" wrap="wrap">
              {navItems.map((item) => {
                const current = pathname === item.to

                return (
                  <Anchor
                    key={item.to}
                    component={Link}
                    to={item.to}
                    c={current ? undefined : 'dimmed'}
                    fw={current ? 600 : 400}
                    aria-current={current ? 'page' : undefined}
                  >
                    {item.label}
                  </Anchor>
                )
              })}
            </Group>
          </Group>
        </Container>
      </Box>

      <Box component="main">
        <Outlet />
      </Box>
    </>
  )
}
