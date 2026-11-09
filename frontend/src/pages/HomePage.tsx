import { Button, Container, Paper, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import { Link } from 'react-router'

const capabilities = [
  'Выбрать тип встречи и её длительность',
  'Забронировать свободный слот на 14 дней вперёд в рабочие часы Пн–Пт, 10:00–18:00 (МСК)',
  'Записаться без регистрации — достаточно имени',
]

export function HomePage() {
  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Title order={1}>Календарь звонков</Title>
        <Text c="dimmed">
          Календарь звонков — сервис бронирования встреч без регистрации. Свободные слоты видны
          сразу: занятый слот исчезает из списка.
        </Text>

        <Button component={Link} to="/book" size="lg" w="fit-content">
          Записаться
        </Button>

        <div>
          <Title order={2} mb="md">
            Возможности
          </Title>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
            {capabilities.map((capability) => (
              <Paper key={capability} withBorder p="md" radius="md">
                <Text>{capability}</Text>
              </Paper>
            ))}
          </SimpleGrid>
        </div>
      </Stack>
    </Container>
  )
}
