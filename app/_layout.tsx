import { Stack } from "expo-router";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SessionProvider, useSession } from "../context/SessionContext";

function AppHydrationGuard() {
  const { isReady: isCustomerReady } = useSession();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <AppHydrationGuard />
      </SessionProvider>
    </ErrorBoundary>
  );
}
