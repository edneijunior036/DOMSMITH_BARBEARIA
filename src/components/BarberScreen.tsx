import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { Bell, X, Pencil, Trash2, Plus, Check, TrendingUp, TrendingDown, DollarSign, Users, Scissors, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Json } from '@/integrations/supabase/types';

interface ServicoItem {
  id: number;
  nome: string;
  preco: number;
  icone: string | null;
  categoria: string | null;
}

interface AgendamentoRow {
  id: number;
  cliente_id: string;
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

interface BarbeiroRow {
  id: number;
  nome: string;
  disponivel: boolean | null;
}

interface ClienteInfo {
  cliente_id: string;
  cliente_email: string;
  display_name: string | null;
  phone: string | null;
  total_cortes: number;
  cortes_para_gratis: number;
}

interface LucroSemanal {
  inicio: Date;
  fim: Date;
  total: number;
  label: string;
}

interface BarberScreenProps {
  onLogout: () => void;
  isPrincipal?: boolean;
}

const BarberScreen = ({ onLogout, isPrincipal = false }: BarberScreenProps) => {
  const { user } = useAuth();
  const [agendamentos, setAgendamentos] = useState<AgendamentoRow[]>([]);
  const [barbeiros, setBarbeiros] = useState<BarbeiroRow[]>([]);
  const [servicos, setServicos] = useState<ServicoItem[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [notificacoesVistas, setNotificacoesVistas] = useState<number[]>([]);
  const [showNotif, setShowNotif] = useState(false);
  const [selectedAgendamento, setSelectedAgendamento] = useState<AgendamentoRow | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);
  const [editServiceForm, setEditServiceForm] = useState({ nome: '', preco: '', icone: '' });
  const [showAddService, setShowAddService] = useState(false);
  const [newServiceForm, setNewServiceForm] = useState({ nome: '', preco: '', icone: '✂️' });
  const [lucrosSemanais, setLucrosSemanais] = useState<LucroSemanal[]>([]);
  const [semanaOffset, setSemanaOffset] = useState(0);
  const [clientes, setClientes] = useState<ClienteInfo[]>([]);
  const [showClientes, setShowClientes] = useState(false);
  const [activeTab, setActiveTab] = useState<'agendamentos' | 'lucros' | 'clientes'>('agendamentos');

  const getInicioSemana = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + offset * 7);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const carregar = useCallback(async () => {
    if (!user) return;
    const [agendRes, barbRes, servRes, notifRes] = await Promise.all([
      supabase.from('agendamentos').select('*').order('data_hora'),
      supabase.from('barbeiros').select('*'),
      supabase.from('servicos').select('*').order('id'),
      supabase.from('notificacoes_vistas').select('agendamento_id').eq('user_id', user.id),
    ]);
    const allAgend = (agendRes.data || []) as AgendamentoRow[];
    setAgendamentos(allAgend);
    setBarbeiros((barbRes.data || []) as BarbeiroRow[]);
    setServicos((servRes.data || []) as ServicoItem[]);
    setNotificacoesVistas((notifRes.data || []).map(n => n.agendamento_id));

    // Calculate weekly profits for multiple weeks
    if (isPrincipal) {
      const paidAgend = allAgend.filter(a => a.pago);
      const semanas: LucroSemanal[] = [];
      for (let i = -2; i <= 2; i++) {
        const inicio = getInicioSemana(i);
        const fim = new Date(inicio);
        fim.setDate(fim.getDate() + 7);
        const total = paidAgend
          .filter(a => { const d = new Date(a.data_hora); return d >= inicio && d < fim; })
          .reduce((sum, a) => sum + Number(a.total), 0);
        const labels = ['2 sem. atrás', 'Sem. anterior', 'Esta semana', 'Próx. semana', 'Daqui 2 sem.'];
        semanas.push({ inicio, fim, total, label: labels[i + 2] });
      }
      setLucrosSemanais(semanas);

      // Load clients with their cut history
      const { data: histData } = await supabase.from('historico_cortes').select('*');
      const { data: profilesData } = await supabase.from('profiles').select('user_id, display_name, phone');
      
      const clientesMap: ClienteInfo[] = (histData || []).map(h => {
        const profile = (profilesData || []).find(p => p.user_id === h.cliente_id);
        return {
          cliente_id: h.cliente_id,
          cliente_email: h.cliente_email,
          display_name: profile?.display_name || null,
          phone: profile?.phone || null,
          total_cortes: h.total_cortes || 0,
          cortes_para_gratis: h.cortes_para_gratis || 10,
        };
      });
      setClientes(clientesMap);
    }
  }, [user, isPrincipal]);

  useEffect(() => { carregar(); }, [carregar]);

  const naoVistas = agendamentos.filter(a => !notificacoesVistas.includes(a.id));

  const marcarComoVista = async (id: number) => {
    if (!user || notificacoesVistas.includes(id)) return;
    await supabase.from('notificacoes_vistas').insert({ user_id: user.id, agendamento_id: id });
    setNotificacoesVistas(prev => [...prev, id]);
  };

  const abrirDetalhes = (a: AgendamentoRow) => { marcarComoVista(a.id); setSelectedAgendamento(a); setShowNotif(false); };

  const cancelar = async (id: number) => {
    await supabase.from('agendamentos').delete().eq('id', id);
    setSelectedAgendamento(null);
    carregar();
    toast.success('Agendamento removido.');
  };

  const confirmarPagamento = async (id: number) => {
    const a = agendamentos.find(x => x.id === id);
    if (!a || a.pago) return;

    await supabase.from('agendamentos').update({ pago: true, status: 'Concluído' }).eq('id', id);

    // Update fidelidade
    const { data: hist } = await supabase.from('historico_cortes').select('*').eq('cliente_id', a.cliente_id).single();
    if (hist) {
      const newTotal = (hist.total_cortes || 0) + 1;
      let cortesParaGratis = 10 - (newTotal % 10);
      if (cortesParaGratis === 10 && newTotal > 0) cortesParaGratis = 0;
      await supabase.from('historico_cortes').update({
        total_cortes: newTotal,
        cortes_para_gratis: cortesParaGratis,
        updated_at: new Date().toISOString(),
      }).eq('cliente_id', a.cliente_id);
      const gratis = newTotal % 10 === 0;
      if (gratis) {
        toast.success(`💰 Pagamento confirmado! 🎉 ${a.cliente_email} completou 10 cortes — próximo é GRÁTIS!`);
      } else {
        toast.success(`💰 Pagamento confirmado! Faltam ${cortesParaGratis} cortes para ${a.cliente_email} ganhar 1 grátis.`);
      }
    } else {
      await supabase.from('historico_cortes').insert({
        cliente_id: a.cliente_id,
        cliente_email: a.cliente_email,
        total_cortes: 1,
        cortes_para_gratis: 9,
      });
      toast.success(`💰 Pagamento confirmado! Faltam 9 cortes para ${a.cliente_email} ganhar 1 grátis.`);
    }
    setSelectedAgendamento(null);
    carregar();
  };

  const addBarbeiro = async () => {
    if (!novoNome.trim()) return;
    await supabase.from('barbeiros').insert({ nome: novoNome.trim() });
    setNovoNome('');
    carregar();
    toast.success('Barbeiro adicionado!');
  };

  const toggleDisp = async (id: number) => {
    const b = barbeiros.find(x => x.id === id);
    if (b) {
      await supabase.from('barbeiros').update({ disponivel: !b.disponivel }).eq('id', id);
      carregar();
    }
  };

  const startEditService = (s: ServicoItem) => {
    setEditingServiceId(s.id);
    setEditServiceForm({ nome: s.nome, preco: String(s.preco), icone: s.icone || '✂️' });
  };

  const saveEditService = async () => {
    if (!editServiceForm.nome.trim() || !editServiceForm.preco) return;
    await supabase.from('servicos').update({
      nome: editServiceForm.nome.trim(),
      preco: parseFloat(editServiceForm.preco),
      icone: editServiceForm.icone || '✂️',
    }).eq('id', editingServiceId!);
    setEditingServiceId(null);
    carregar();
    toast.success('Serviço atualizado!');
  };

  const deleteService = async (id: number) => {
    await supabase.from('servicos').delete().eq('id', id);
    carregar();
    toast.success('Serviço removido!');
  };

  const addService = async () => {
    if (!newServiceForm.nome.trim() || !newServiceForm.preco) return;
    await supabase.from('servicos').insert({
      nome: newServiceForm.nome.trim(),
      preco: parseFloat(newServiceForm.preco),
      icone: newServiceForm.icone || '✂️',
    });
    setNewServiceForm({ nome: '', preco: '', icone: '✂️' });
    setShowAddService(false);
    carregar();
    toast.success('Serviço adicionado!');
  };

  const semanaAtualIdx = 2; // index of "Esta semana" in the lucrosSemanais array
  const semanaAtual = lucrosSemanais[semanaAtualIdx];
  const semanaAnterior = lucrosSemanais[semanaAtualIdx - 1];
  const percentual = semanaAnterior && semanaAnterior.total > 0
    ? ((semanaAtual?.total || 0) - semanaAnterior.total) / semanaAnterior.total * 100
    : (semanaAtual?.total || 0) > 0 ? 100 : 0;

  const pendentes = agendamentos.filter(a => !a.pago);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border glass-card sticky top-0 z-20">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/capa/capa.png" alt="DOM SMITH" className="w-28 h-28 rounded-full flex-shrink-0 object-contain glow-gold shadow-xl drop-shadow-lg filter brightness-110 contrast-110" />
            <div>
              <h2 className="font-display text-lg font-semibold gold-text">DOM SMITH</h2>
              <span className="text-xs text-muted-foreground">{isPrincipal ? '👑 Principal' : '👤 Auxiliar'}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setShowNotif(!showNotif)} className="relative p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-all">
                <Bell className="w-5 h-5" />
                {naoVistas.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full gold-gradient text-primary-foreground text-xs font-bold flex items-center justify-center animate-pulse">{naoVistas.length}</span>
                )}
              </button>
              {showNotif && (
                <div className="absolute right-0 top-12 w-80 glass-card rounded-xl border border-border shadow-2xl z-50 overflow-hidden">
                  <div className="p-4 border-b border-border flex items-center justify-between">
                    <h4 className="font-display font-semibold text-foreground text-sm">Notificações</h4>
                    <button onClick={() => setShowNotif(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {agendamentos.length === 0 ? (
                      <p className="p-4 text-muted-foreground text-sm text-center">Nenhuma notificação.</p>
                    ) : agendamentos.map(a => {
                      const isNew = !notificacoesVistas.includes(a.id);
                      return (
                        <button key={a.id} onClick={() => abrirDetalhes(a)} className={`w-full text-left p-3 border-b border-border hover:bg-secondary/50 transition-all ${isNew ? 'bg-primary/5' : ''}`}>
                          <div className="flex items-center gap-2">
                            {isNew && <span className="w-2 h-2 rounded-full gold-gradient flex-shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground text-sm font-medium truncate">{a.cliente_email}</p>
                              <p className="text-muted-foreground text-xs">{new Date(a.data_hora).toLocaleString('pt-BR')} · R$ {Number(a.total).toFixed(2)}</p>
                              {!a.pago && <span className="text-xs text-warning">⏳ Aguardando pagamento</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <button onClick={onLogout} className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-primary transition-all text-sm">Sair</button>
          </div>
        </div>
      </header>

      {/* Detail Modal */}
      {selectedAgendamento && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setSelectedAgendamento(null)}>
          <div className="glass-card rounded-2xl p-6 max-w-md w-full mx-4 border border-border animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-display text-lg font-bold gold-text">Detalhes do Agendamento</h3>
              <button onClick={() => setSelectedAgendamento(null)} className="text-muted-foreground hover:text-foreground"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between"><span className="text-muted-foreground text-sm">Cliente:</span><span className="text-foreground font-medium text-sm">{selectedAgendamento.cliente_email}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground text-sm">Data/Hora:</span><span className="text-foreground font-medium text-sm">{new Date(selectedAgendamento.data_hora).toLocaleString('pt-BR')}</span></div>
              {selectedAgendamento.barbeiro_nome && (
                <div className="flex justify-between"><span className="text-muted-foreground text-sm">Barbeiro:</span><span className="text-foreground font-medium text-sm">💇‍♂️ {selectedAgendamento.barbeiro_nome}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground text-sm">Status:</span><span className={`text-xs px-2 py-1 rounded-full font-medium ${selectedAgendamento.pago ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>{selectedAgendamento.pago ? '✅ Pago' : '⏳ Aguardando Pagamento'}</span></div>
              {selectedAgendamento.fidelidade_usada && (
                <div className="flex justify-between"><span className="text-muted-foreground text-sm">Fidelidade:</span><span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary font-medium">🎁 Corte Grátis</span></div>
              )}
              <div className="border-t border-border pt-3">
                <p className="text-muted-foreground text-sm mb-2">Serviços:</p>
                {((selectedAgendamento.servicos as any[]) || []).map((s: any) => (
                  <div key={s.id} className="flex justify-between py-1">
                    <span className="text-foreground text-sm">{s.icone} {s.nome}</span>
                    <span className="text-primary text-sm font-semibold">R$ {Number(s.preco).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-3 flex justify-between items-center">
                <span className="text-foreground font-bold">Total:</span>
                <span className="text-xl font-bold gold-text">{selectedAgendamento.fidelidade_usada ? '🎁 GRÁTIS' : `R$ ${Number(selectedAgendamento.total).toFixed(2)}`}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {!selectedAgendamento.pago && (
                <button onClick={() => confirmarPagamento(selectedAgendamento.id)} className="flex-1 py-3 rounded-xl gold-gradient text-primary-foreground font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                  <DollarSign className="w-5 h-5" /> Confirmar Pagamento
                </button>
              )}
              <button onClick={() => cancelar(selectedAgendamento.id)} className={`${selectedAgendamento.pago ? 'flex-1' : ''} py-3 px-4 rounded-xl border border-destructive/50 text-destructive hover:bg-destructive/10 transition-all font-medium`}>Remover</button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs for principal */}
      {isPrincipal && (
        <div className="container mx-auto px-4 pt-6 max-w-4xl">
          <div className="flex gap-2 overflow-x-auto">
            {[
              { key: 'agendamentos' as const, label: '📋 Agendamentos', count: pendentes.length },
              { key: 'lucros' as const, label: '📊 Lucros' },
              { key: 'clientes' as const, label: '👥 Clientes', count: clientes.length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all ${
                  activeTab === tab.key
                    ? 'gold-gradient text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-primary/20 text-primary'}`}>{tab.count}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-10">
        {/* Lucros Tab */}
        {isPrincipal && activeTab === 'lucros' && (
          <section className="animate-fade-in space-y-6">
            <h3 className="font-display text-2xl font-bold gold-text">📊 Lucros por Semana</h3>
            
            {/* Overview cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="glass-card rounded-xl p-5 text-center">
                <p className="text-muted-foreground text-sm mb-1">Esta Semana</p>
                <p className="text-2xl font-bold gold-text">R$ {(semanaAtual?.total || 0).toFixed(2)}</p>
              </div>
              <div className="glass-card rounded-xl p-5 text-center">
                <p className="text-muted-foreground text-sm mb-1">Semana Anterior</p>
                <p className="text-2xl font-bold text-foreground">R$ {(semanaAnterior?.total || 0).toFixed(2)}</p>
              </div>
              <div className="glass-card rounded-xl p-5 text-center">
                <p className="text-muted-foreground text-sm mb-1">Desempenho</p>
                <div className="flex items-center justify-center gap-2">
                  {percentual >= 0 ? <TrendingUp className="w-5 h-5 text-success" /> : <TrendingDown className="w-5 h-5 text-destructive" />}
                  <p className={`text-2xl font-bold ${percentual >= 0 ? 'text-success' : 'text-destructive'}`}>
                    {percentual >= 0 ? '+' : ''}{percentual.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            {/* Weekly breakdown */}
            <div className="glass-card rounded-xl p-5">
              <h4 className="font-display font-semibold text-foreground mb-4">Visão Semanal</h4>
              <div className="space-y-3">
                {lucrosSemanais.map((sem, i) => {
                  const maxTotal = Math.max(...lucrosSemanais.map(s => s.total), 1);
                  const pct = (sem.total / maxTotal) * 100;
                  const isCurrent = i === semanaAtualIdx;
                  return (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-lg ${isCurrent ? 'bg-primary/10 border border-primary/30' : ''}`}>
                      <span className={`text-sm font-medium w-28 flex-shrink-0 ${isCurrent ? 'text-primary' : 'text-muted-foreground'}`}>{sem.label}</span>
                      <div className="flex-1 h-4 bg-secondary rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${isCurrent ? 'gold-gradient' : 'bg-muted-foreground/30'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-sm font-bold w-28 text-right ${isCurrent ? 'gold-text' : 'text-foreground'}`}>R$ {sem.total.toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Total geral */}
            <div className="glass-card rounded-xl p-5 text-center">
              <p className="text-muted-foreground text-sm mb-1">Total Geral (Pagos)</p>
              <p className="text-3xl font-bold gold-text">R$ {agendamentos.filter(a => a.pago).reduce((s, a) => s + Number(a.total), 0).toFixed(2)}</p>
            </div>
          </section>
        )}

        {/* Clientes Tab */}
        {isPrincipal && activeTab === 'clientes' && (
          <section className="animate-fade-in space-y-6">
            <h3 className="font-display text-2xl font-bold gold-text">👥 Clientes Cadastrados</h3>
            {clientes.length === 0 ? (
              <div className="glass-card rounded-xl p-8 text-center">
                <p className="text-muted-foreground">Nenhum cliente com histórico ainda.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {clientes.map(c => {
                  const progresso = ((10 - c.cortes_para_gratis) / 10) * 100;
                  const temGratis = c.cortes_para_gratis === 0;
                  return (
                    <div key={c.cliente_id} className="glass-card rounded-xl p-5 animate-scale-in">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <p className="text-foreground font-medium">{c.display_name || c.cliente_email}</p>
                          <p className="text-muted-foreground text-xs">{c.cliente_email}</p>
                          {c.phone && <p className="text-muted-foreground text-xs">📱 {c.phone}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-primary font-bold text-lg">{c.total_cortes}</p>
                          <p className="text-muted-foreground text-xs">cortes</p>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Fidelidade</span>
                          <span>{10 - c.cortes_para_gratis}/10</span>
                        </div>
                        <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full gold-gradient rounded-full transition-all" style={{ width: `${progresso}%` }} />
                        </div>
                        {temGratis && <p className="mt-1 text-xs text-primary font-bold">🎉 Próximo corte GRÁTIS!</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Agendamentos Tab (or default for auxiliar) */}
        {(activeTab === 'agendamentos' || !isPrincipal) && (
          <>
            {/* Serviços CRUD - principal only */}
            {isPrincipal && (
              <section className="animate-fade-in">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-display text-2xl font-bold gold-text">Gerenciar Serviços</h3>
                  <button onClick={() => setShowAddService(!showAddService)} className="flex items-center gap-2 px-4 py-2 rounded-lg gold-gradient text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity">
                    <Plus className="w-4 h-4" /> Novo Serviço
                  </button>
                </div>

                {showAddService && (
                  <div className="glass-card rounded-xl p-4 mb-4 flex flex-wrap gap-2 items-end animate-scale-in">
                    <input placeholder="Ícone" value={newServiceForm.icone} onChange={e => setNewServiceForm({ ...newServiceForm, icone: e.target.value })} className="w-20 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                    <input placeholder="Nome do serviço" value={newServiceForm.nome} onChange={e => setNewServiceForm({ ...newServiceForm, nome: e.target.value })} className="flex-1 min-w-[150px] px-3 py-2 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                    <input type="number" placeholder="Preço" value={newServiceForm.preco} onChange={e => setNewServiceForm({ ...newServiceForm, preco: e.target.value })} className="w-28 px-3 py-2 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary" />
                    <button onClick={addService} className="px-4 py-2 rounded-lg gold-gradient text-primary-foreground font-semibold hover:opacity-90 transition-opacity"><Check className="w-4 h-4" /></button>
                  </div>
                )}

                <div className="space-y-2">
                  {servicos.map(s => (
                    <div key={s.id} className="glass-card rounded-xl p-4 flex items-center gap-3">
                      {editingServiceId === s.id ? (
                        <>
                          <input value={editServiceForm.icone} onChange={e => setEditServiceForm({ ...editServiceForm, icone: e.target.value })} className="w-12 px-2 py-1 rounded-lg bg-secondary border border-border text-foreground text-center text-lg focus:outline-none focus:ring-2 focus:ring-primary" />
                          <input value={editServiceForm.nome} onChange={e => setEditServiceForm({ ...editServiceForm, nome: e.target.value })} className="flex-1 px-3 py-1 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
                          <input type="number" value={editServiceForm.preco} onChange={e => setEditServiceForm({ ...editServiceForm, preco: e.target.value })} className="w-24 px-3 py-1 rounded-lg bg-secondary border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm" />
                          <button onClick={saveEditService} className="p-2 rounded-lg text-success hover:bg-success/10 transition-all"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setEditingServiceId(null)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground transition-all"><X className="w-4 h-4" /></button>
                        </>
                      ) : (
                        <>
                          <span className="text-2xl">{s.icone}</span>
                          <span className="flex-1 text-foreground font-medium text-sm">{s.nome}</span>
                          <span className="text-primary font-bold text-sm">R$ {Number(s.preco).toFixed(2)}</span>
                          <button onClick={() => startEditService(s)} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => deleteService(s.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"><Trash2 className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Agendamentos */}
            <section className="animate-fade-in">
              <div className="flex items-center gap-3 mb-6">
                <h3 className="font-display text-2xl font-bold gold-text">Agendamentos</h3>
                <span className="gold-gradient text-primary-foreground text-sm font-bold px-3 py-1 rounded-full">{agendamentos.length}</span>
              </div>
              {agendamentos.length === 0 ? (
                <div className="glass-card rounded-xl p-8 text-center"><p className="text-muted-foreground">Nenhum agendamento no momento.</p></div>
              ) : (
                <div className="space-y-3">
                  {agendamentos.map(a => (
                    <button key={a.id} onClick={() => abrirDetalhes(a)} className="w-full text-left glass-card rounded-xl p-5 animate-scale-in hover:border-primary/30 transition-all">
                      <div className="flex items-start justify-between mb-3">
                        <span className="text-foreground font-medium text-sm">📅 {new Date(a.data_hora).toLocaleString('pt-BR')}</span>
                        <div className="flex gap-2">
                          {a.fidelidade_usada && <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary font-medium">🎁 Grátis</span>}
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${a.pago ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>{a.pago ? '✅ Pago' : '⏳ Pendente'}</span>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground"><span className="text-foreground">Cliente:</span> {a.cliente_email}</p>
                      <p className="text-sm text-muted-foreground mt-1"><span className="text-foreground">Serviços:</span> {((a.servicos as any[]) || []).map((s: any) => s.nome).join(', ')}</p>
                      {a.barbeiro_nome && <p className="text-sm text-muted-foreground mt-1"><span className="text-foreground">Barbeiro:</span> 💇‍♂️ {a.barbeiro_nome}</p>}
                      <div className="mt-3 pt-3 border-t border-border flex justify-between items-center">
                        <span className="text-primary font-bold">{a.fidelidade_usada ? '🎁 GRÁTIS' : `R$ ${Number(a.total).toFixed(2)}`}</span>
                        {!a.pago && (
                          <span className="text-xs text-warning font-medium flex items-center gap-1">
                            <DollarSign className="w-3 h-3" /> Clique para confirmar pagamento
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>

            {/* Barbeiros */}
            <section className="animate-fade-in">
              <h3 className="font-display text-2xl font-bold mb-6 gold-text">Gerenciar Barbeiros</h3>
              {isPrincipal && (
                <div className="flex gap-2 mb-6">
                  <input type="text" placeholder="Nome do barbeiro" value={novoNome} onChange={e => setNovoNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBarbeiro()}
                    className="flex-1 px-4 py-3 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
                  <button onClick={addBarbeiro} className="px-6 py-3 rounded-lg gold-gradient text-primary-foreground font-semibold hover:opacity-90 transition-opacity">Adicionar</button>
                </div>
              )}
              <div className="space-y-2">
                {barbeiros.map(b => (
                  <div key={b.id} className="glass-card rounded-xl p-4 flex items-center justify-between">
                    <span className="text-foreground font-medium">{b.nome}</span>
                    <button onClick={() => toggleDisp(b.id)} className={`text-sm px-3 py-1.5 rounded-full font-medium transition-all ${b.disponivel ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                      {b.disponivel ? '✅ Disponível' : '❌ Indisponível'}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default BarberScreen;
