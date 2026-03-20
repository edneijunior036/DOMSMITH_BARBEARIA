import { useAuth } from '@/hooks/useAuth';
import LoginScreen from '@/components/LoginScreen';
import ClientScreen from '@/components/ClientScreen';
import BarberScreen from '@/components/BarberScreen';

const Index = () => {
  const { user, role, loading, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <span className="text-5xl block mb-4 animate-pulse">💈</span>
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;

  if (role === 'barbeiro') return <BarberScreen onLogout={signOut} isPrincipal={true} />;
  if (role === 'barbeiro_auxiliar') return <BarberScreen onLogout={signOut} isPrincipal={false} />;

  return <ClientScreen onLogout={signOut} />;
};

export default Index;
