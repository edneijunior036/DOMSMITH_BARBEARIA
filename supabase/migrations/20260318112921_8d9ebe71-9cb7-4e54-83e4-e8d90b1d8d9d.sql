
-- Enum de roles
CREATE TYPE public.app_role AS ENUM ('cliente', 'barbeiro', 'barbeiro_auxiliar');

-- Tabela de roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-create profile + default role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'cliente');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Barbeiros
CREATE TABLE public.barbeiros (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  disponivel BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.barbeiros ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view barbeiros" ON public.barbeiros FOR SELECT TO authenticated USING (true);
CREATE POLICY "Principal can insert barbeiros" ON public.barbeiros FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'barbeiro'));
CREATE POLICY "Principal can update barbeiros" ON public.barbeiros FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'barbeiro'));
CREATE POLICY "Principal can delete barbeiros" ON public.barbeiros FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'barbeiro'));

-- Serviços
CREATE TABLE public.servicos (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  preco NUMERIC(10,2) NOT NULL,
  icone TEXT DEFAULT '✂️',
  categoria TEXT DEFAULT 'individual',
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.servicos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view servicos" ON public.servicos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Principal can insert servicos" ON public.servicos FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'barbeiro'));
CREATE POLICY "Principal can update servicos" ON public.servicos FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'barbeiro'));
CREATE POLICY "Principal can delete servicos" ON public.servicos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'barbeiro'));

-- Agendamentos
CREATE TABLE public.agendamentos (
  id SERIAL PRIMARY KEY,
  cliente_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  cliente_email TEXT NOT NULL,
  servicos JSONB NOT NULL DEFAULT '[]',
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  data_hora TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'Agendado',
  barbeiro_id INTEGER REFERENCES public.barbeiros(id),
  barbeiro_nome TEXT,
  fidelidade_usada BOOLEAN DEFAULT false,
  pago BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients view own agendamentos" ON public.agendamentos FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id OR public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));
CREATE POLICY "Clients create agendamentos" ON public.agendamentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = cliente_id);
CREATE POLICY "Barbers update agendamentos" ON public.agendamentos FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));
CREATE POLICY "Barbers delete agendamentos" ON public.agendamentos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));

-- Histórico de cortes (fidelidade)
CREATE TABLE public.historico_cortes (
  id SERIAL PRIMARY KEY,
  cliente_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  cliente_email TEXT NOT NULL,
  total_cortes INTEGER DEFAULT 0,
  cortes_para_gratis INTEGER DEFAULT 10,
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.historico_cortes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "View own historico" ON public.historico_cortes FOR SELECT TO authenticated
  USING (auth.uid() = cliente_id OR public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));
CREATE POLICY "Barbers insert historico" ON public.historico_cortes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));
CREATE POLICY "Barbers update historico" ON public.historico_cortes FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'barbeiro') OR public.has_role(auth.uid(), 'barbeiro_auxiliar'));

-- Notificações vistas
CREATE TABLE public.notificacoes_vistas (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  agendamento_id INTEGER REFERENCES public.agendamentos(id) ON DELETE CASCADE NOT NULL,
  UNIQUE(user_id, agendamento_id)
);
ALTER TABLE public.notificacoes_vistas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notificacoes" ON public.notificacoes_vistas FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Seed barbeiros e serviços
INSERT INTO public.barbeiros (id, nome, disponivel) VALUES (1, 'SMTHI', true), (2, 'LORÃO', true);

INSERT INTO public.servicos (id, nome, preco, icone, categoria) VALUES
(1, 'Corte', 35.0, '✂️', 'individual'),
(2, 'Luzes', 80.0, '✨', 'individual'),
(3, 'Sobrancelha', 10.0, '👁️', 'individual'),
(4, 'Barba', 25.0, '🪒', 'individual'),
(5, 'Assepsia Nasal/Auricular', 10.0, '👃', 'individual'),
(6, 'Platinado', 100.0, '💎', 'individual'),
(7, 'Pigmentação', 15.0, '🎨', 'individual'),
(100, 'Corte + Pigmentação', 40.0, '💈', 'combo'),
(101, 'Corte + Barba', 55.0, '💈', 'combo'),
(200, '🔥 Sexta: Corte+Pigmentação+Barba', 60.0, '🔥', 'promo'),
(201, '🔥 Sábado: Corte+Sobrancelha+Barba', 65.0, '🔥', 'promo'),
(202, '🔥 Domingo: Corte', 30.0, '🔥', 'promo'),
(203, '🔥 Segunda: Barba+Massagem Pé', 35.0, '🔥', 'promo');
