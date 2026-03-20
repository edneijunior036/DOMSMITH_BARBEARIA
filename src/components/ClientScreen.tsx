import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Gift, History, X } from 'lucide-react';
import type { Json } from '@/integrations/supabase/types';

interface ServicoItem {
  id: number;
  nome: string;
  preco: number;
  icone: string;
  categoria: string | null;
}

interface AgendamentoRow {
  id: number;
  cliente_email: string;
  servicos: Json;
  total: number;
  data_hora: string;
  status: string | null;
  barbeiro_id: number | null;
  barbeiro_nome: string | null;
  fidelidade_usada: boolean | null;
  pago: boolean | null;
}

interface HistoricoInfo {
  totalCortes: number;
  cortesParaGratis: number;
}

interface ClientScreenProps {
  onLogout: () => void;
}

const ClientScreen = ({ onLogout }: ClientScreenProps) => {
  const { user, displayName } = useAuth();
  const [servicos, setServicos] = useState<ServicoItem[]>([]);
  const [barbeiros, setBarbeiros] = useState<{ id: number; nome: string; disponivel: boolean | null }[]>([]);
  const [selecionados, setSelecionados] = useState<ServicoItem[]>([]);
  const [dataHora, setDataHora] = useState('');
  const [barbeiroId, setBarbeiroId] = useState<number | null>(null);
  const [showHistorico, setShowHistorico] = useState(false);
  const [meusAgendamentos, setMeusAgendamentos] = useState<AgendamentoRow[]>([]);
  const [historico, setHistorico] = useState<HistoricoInfo>({ totalCortes: 0, cortesParaGratis: 10 });
  const [loading, setLoading] = useState(true);

  const clientName = displayName || user?.email?.split('@')[0] || 'Cliente';

  const fetchData = async () => {
    if (!user) return;
    const [servicosRes, barbeirosRes, agendRes, histRes] = await Promise.all([
      supabase.from('servicos').select('*').order('id'),
      supabase.from('barbeiros').select('*').eq('disponivel', true),
      supabase.from('agendamentos').select('*').eq('cliente_id', user.id).order('data_hora', { ascending: false }),
      supabase.from('historico_cortes').select('*').eq('cliente_id', user.id).single(),
    ]);
    setServicos((servicosRes.data || []) as ServicoItem[]);
    setBarbeiros(barbeirosRes.data || []);
    setMeusAgendamentos((agendRes.data || []) as AgendamentoRow[]);
    if (histRes.data) {
      setHistorico({ totalCortes: histRes.data.total_cortes || 0, cortesParaGratis: histRes.data.cortes_para_gratis || 10 });
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [user]);

  const individuais = servicos.filter(s => !s.categoria || s.categoria === 'individual');
  const combos = servicos.filter(s => s.categoria === 'combo');
  const promos = servicos.filter(s => s.categoria === 'promo');

  const toggleServico = (servico: ServicoItem) => {
    setSelecionados(prev => {
      const exists = prev.find(s => s.id === servico.id);
      if (exists) return prev.filter(s => s.id !== servico.id);
      return [...prev, servico];
    });
  };

  const total = selecionados.reduce((acc, s) => acc + s.preco, 0);
  const temGratis = historico.cortesParaGratis === 0;
  const totalFinal = temGratis ? 0 : total;

  const agendar = async () => {
    if (!user) return;
    if (selecionados.length === 0) { toast.error('Selecione pelo menos um serviço!'); return; }
    if (!barbeiroId) { toast.error('Selecione um barbeiro!'); return; }
    if (!dataHora) { toast.error('Selecione a data e hora!'); return; }
    if (new Date(dataHora) <= new Date()) { toast.error('Não é possível agendar no passado!'); return; }

    const barbeiroSelecionado = barbeiros.find(b => b.id === barbeiroId);

    // Check conflict
    const { data: conflito } = await supabase.from('agendamentos')
      .select('id').eq('data_hora', dataHora).eq('barbeiro_id', barbeiroId).limit(1);
    if (conflito && conflito.length > 0) { toast.error('Este barbeiro já está ocupado nesse horário!'); return; }

    const { error } = await supabase.from('agendamentos').insert({
      cliente_id: user.id,
      cliente_email: user.email || '',
      servicos: JSON.parse(JSON.stringify(selecionados)),
      total: totalFinal,
      data_hora: dataHora,
      barbeiro_id: barbeiroId,
      barbeiro_nome: barbeiroSelecionado?.nome || '',
      fidelidade_usada: temGratis,
    });

    if (error) { toast.error('Erro ao agendar: ' + error.message); return; }

    toast.success('Agendamento confirmado! O ponto fidelidade será registrado após a confirmação do pagamento.');
    setSelecionados([]);
    setDataHora('');
    setBarbeiroId(null);
    fetchData();
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><p className="text-muted-foreground animate-pulse">Carregando...</p></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/capa/capa.png" alt="DOM SMITH" className="w-28 h-28 rounded-full flex-shrink-0 object-contain glow-gold shadow-xl drop-shadow-lg filter brightness-110 contrast-110" />
            <h2 className="font-display text-lg font-semibold text-foreground">
              Olá, <span className="gold-text">{clientName}</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistorico(true)} className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-all">
              <History className="w-5 h-5" />
            </button>
            <button onClick={onLogout} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-all text-sm">Sair</button>
          </div>
        </div>
      </header>

      {/* Histórico Modal */}
      {showHistorico && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowHistorico(false)}>
          <div className="glass-card rounded-2xl p-6 max-w-md w-full mx-4 border border-border animate-scale-in max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold gold-text">Meu Histórico</h3>
              <button onClick={() => setShowHistorico(false)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>

            <div className="glass-card rounded-xl p-4 mb-4 border border-primary/30">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="w-5 h-5 text-primary" />
                <span className="font-display font-semibold text-foreground">Programa Fidelidade</span>
              </div>
              <p className="text-sm text-muted-foreground">Total de cortes: <span className="text-foreground font-bold">{historico.totalCortes}</span></p>
              <div className="mt-2">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Progresso</span>
                  <span>{10 - historico.cortesParaGratis}/10</span>
                </div>
                <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full gold-gradient rounded-full transition-all" style={{ width: `${((10 - historico.cortesParaGratis) / 10) * 100}%` }} />
                </div>
              </div>
              {temGratis && <p className="mt-2 text-sm text-primary font-bold animate-pulse">🎉 Você tem 1 corte GRÁTIS!</p>}
            </div>

            {meusAgendamentos.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center">Nenhum agendamento ainda.</p>
            ) : (
              <div className="space-y-2">
                {meusAgendamentos.map(a => {
                  const servs = (a.servicos as any[]) || [];
                  return (
                    <div key={a.id} className="glass-card rounded-xl p-3 border border-border">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm text-foreground font-medium">📅 {new Date(a.data_hora).toLocaleString('pt-BR')}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${a.pago ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>{a.pago ? '✅ Pago' : '⏳ Pendente'}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{servs.map((s: any) => s.nome).join(', ')}</p>
                      <div className="flex justify-between mt-1">
                        <span className="text-xs text-muted-foreground">💇‍♂️ {a.barbeiro_nome}</span>
                        <span className="text-sm font-bold text-primary">
                          {a.fidelidade_usada ? '🎁 GRÁTIS' : `R$ ${Number(a.total).toFixed(2)}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-10">
        {temGratis && (
          <div className="glass-card rounded-xl p-4 border border-primary/50 animate-pulse text-center">
            <p className="text-lg font-bold gold-text">🎉 Seu próximo corte é GRÁTIS!</p>
          </div>
        )}

        {/* Serviços */}
        <section className="animate-fade-in">
          <h3 className="font-display text-2xl font-bold mb-4 gold-text">1. Serviços</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {individuais.map(servico => {
              const isSelected = selecionados.some(s => s.id === servico.id);
              return (
                <button key={servico.id} onClick={() => toggleServico(servico)}
                  className={`p-4 rounded-xl border-2 transition-all duration-200 text-center ${isSelected ? 'border-primary glow-gold bg-primary/10' : 'border-border bg-card hover:border-primary/50'}`}>
                  <span className="text-3xl block mb-2">{servico.icone}</span>
                  <p className="font-medium text-sm text-foreground">{servico.nome}</p>
                  <p className="text-primary font-bold mt-1">R$ {Number(servico.preco).toFixed(2)}</p>
                </button>
              );
            })}
          </div>
        </section>

        {combos.length > 0 && (
          <section className="animate-fade-in">
            <h3 className="font-display text-xl font-bold mb-4 gold-text">💈 Combos</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {combos.map(servico => {
                const isSelected = selecionados.some(s => s.id === servico.id);
                return (
                  <button key={servico.id} onClick={() => toggleServico(servico)}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 text-center ${isSelected ? 'border-primary glow-gold bg-primary/10' : 'border-border bg-card hover:border-primary/50'}`}>
                    <span className="text-3xl block mb-2">{servico.icone}</span>
                    <p className="font-medium text-sm text-foreground">{servico.nome}</p>
                    <p className="text-primary font-bold mt-1">R$ {Number(servico.preco).toFixed(2)}</p>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {promos.length > 0 && (
          <section className="animate-fade-in">
            <h3 className="font-display text-xl font-bold mb-4 gold-text">🔥 Promoções</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {promos.map(servico => {
                const isSelected = selecionados.some(s => s.id === servico.id);
                return (
                  <button key={servico.id} onClick={() => toggleServico(servico)}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 text-left flex items-center gap-4 ${isSelected ? 'border-primary glow-gold bg-primary/10' : 'border-border bg-card hover:border-primary/50'}`}>
                    <span className="text-3xl">{servico.icone}</span>
                    <div>
                      <p className="font-medium text-sm text-foreground">{servico.nome}</p>
                      <p className="text-primary font-bold mt-1">R$ {Number(servico.preco).toFixed(2)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* Aba de Corte */}
        <section className="animate-fade-in glass-card rounded-xl p-6">
          <h4 className="font-display text-lg font-semibold mb-4 text-foreground">✂️ Aba de Corte</h4>
          {selecionados.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum serviço selecionado.</p>
          ) : (
            <div className="space-y-2">
              {selecionados.map(s => (
                <div key={s.id} className="flex justify-between items-center py-2 border-b border-border">
                  <span className="text-foreground text-sm">{s.icone} {s.nome}</span>
                  <span className="text-primary font-semibold text-sm">R$ {Number(s.preco).toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-border flex justify-between items-center">
            <span className="text-muted-foreground font-medium">Total:</span>
            {temGratis ? (
              <div className="text-right">
                <span className="text-sm line-through text-muted-foreground mr-2">R$ {total.toFixed(2)}</span>
                <span className="text-xl font-bold text-success">GRÁTIS 🎁</span>
              </div>
            ) : (
              <span className="text-xl font-bold gold-text">R$ {total.toFixed(2)}</span>
            )}
          </div>
        </section>

        {/* Barbeiro */}
        <section className="animate-fade-in space-y-4">
          <h3 className="font-display text-2xl font-bold gold-text">2. Escolha o Barbeiro</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {barbeiros.map(b => (
              <button key={b.id} onClick={() => setBarbeiroId(b.id)}
                className={`p-4 rounded-xl border-2 transition-all duration-200 text-center ${barbeiroId === b.id ? 'border-primary glow-gold bg-primary/10' : 'border-border bg-card hover:border-primary/50'}`}>
                <span className="text-3xl block mb-2">💇‍♂️</span>
                <p className="font-medium text-sm text-foreground">{b.nome}</p>
              </button>
            ))}
            {barbeiros.length === 0 && <p className="text-muted-foreground text-sm col-span-full">Nenhum barbeiro disponível.</p>}
          </div>
        </section>

        {/* Data/Hora */}
        <section className="animate-fade-in space-y-4">
          <h3 className="font-display text-2xl font-bold gold-text">3. Escolha Data e Hora</h3>
          <input type="datetime-local" value={dataHora} onChange={e => setDataHora(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
          <button onClick={agendar}
            className="w-full py-4 rounded-xl gold-gradient text-primary-foreground font-bold text-lg hover:opacity-90 transition-opacity">
            Confirmar Agendamento
          </button>
        </section>
      </main>
    </div>
  );
};

export default ClientScreen;
