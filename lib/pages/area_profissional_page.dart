import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import 'chat_page.dart';
import 'pix_dialog.dart';
import '../main.dart';
import 'meus_servicos_page.dart';
import 'historico_servicos_page.dart';
import 'meu_perfil_profissional_page.dart';

class AreaProfissionalPage extends StatefulWidget {
  AreaProfissionalPage({Key? key}) : super(key: key);

  @override
  State<AreaProfissionalPage> createState() => _AreaProfissionalPageState();
}

class _AreaProfissionalPageState extends State<AreaProfissionalPage> {
  static const _black         = Color(0xFF0A0A12);
  static const _navyDark      = Color(0xFF0A0A16);
  static const _navyLight     = Color(0xFF1B1F3B);
  static const _white         = Color(0xFFFFFFFF);
  static const _accent        = Color(0xFF2F6FED);
  static const _surface       = Color(0xFFF3F4F8);
  static const _textSecondary = Color(0xFF6B7280);
  static const _premiumGold   = Color(0xFFFFC94D);
  static const _verified      = Color(0xFF34C759);

  final Set<String> _processandoPedidos = {};
  final Set<String> _visualizados       = {};
  final Set<String> _favoritos          = {};
  double? _minhaLat;
  double? _minhaLng;

  Map<String, dynamic> _categoriaEstilo(String categoria) {
    final cat = categoria.toLowerCase();
    if (cat.contains('elétric') || cat.contains('eletric'))
      return {'cor': const Color(0xFF2F6FED), 'icone': Icons.bolt_rounded};
    if (cat.contains('hidráulic') || cat.contains('hidraulic') ||
        cat.contains('encanad') || cat.contains('vazamento'))
      return {'cor': const Color(0xFF16A34A), 'icone': Icons.water_drop_rounded};
    if (cat.contains('pint'))
      return {'cor': const Color(0xFF9333EA), 'icone': Icons.format_paint_rounded};
    if (cat.contains('montagem') || cat.contains('marcenaria') ||
        cat.contains('móve') || cat.contains('move'))
      return {'cor': const Color(0xFFEA580C), 'icone': Icons.handyman_rounded};
    if (cat.contains('limp'))
      return {'cor': const Color(0xFF0D9488), 'icone': Icons.cleaning_services_rounded};
    if (cat.contains('jardin') || cat.contains('jardim'))
      return {'cor': const Color(0xFF65A30D), 'icone': Icons.grass_rounded};
    return {'cor': _accent, 'icone': Icons.build_circle_outlined};
  }

  bool _isRecente(dynamic criadoEm) {
    if (criadoEm == null || criadoEm is! Timestamp) return false;
    return DateTime.now().difference(criadoEm.toDate()).inMinutes < 60;
  }

  @override
  void initState() {
    super.initState();
    _salvarLocalizacao();
  }

  Future<void> _salvarLocalizacao() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    try {
      final permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) return;
      final pos = await Geolocator.getCurrentPosition();
      if (mounted) setState(() { _minhaLat = pos.latitude; _minhaLng = pos.longitude; });
      await FirebaseFirestore.instance.collection('users').doc(user.uid)
          .update({'latitude': pos.latitude, 'longitude': pos.longitude});
    } catch (_) {}
  }

  Future<void> _registrarVisualizacao(String pedidoId) async {
    if (_visualizados.contains(pedidoId)) return;
    _visualizados.add(pedidoId);
    try {
      await FirebaseFirestore.instance.collection('requests').doc(pedidoId)
          .update({'visualizacoes': FieldValue.increment(1)});
    } catch (_) {}
  }

  Future<void> _abrirSuporte() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    final chatId = 'suporte_${user.uid}';
    final docUser = await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
    final nome = docUser.data()?['nome'] ?? docUser.data()?['name'] ?? user.email ?? 'Usuário';
    await FirebaseFirestore.instance.collection('suporte_chats').doc(user.uid).set({
      'userId': user.uid, 'nome': nome, 'tipo': 'profissional',
      'chatId': chatId, 'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
    if (!mounted) return;
    Navigator.push(context, MaterialPageRoute(builder: (_) => ChatPage(chatId: chatId)));
  }

  Future<void> _abrirLocalizacao({double? lat, double? lng, required String endereco}) async {
    Uri uri;
    if (lat != null && lng != null) {
      uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=$lat,$lng');
    } else {
      uri = Uri.parse('https://www.google.com/maps/search/?api=1&query=${Uri.encodeComponent(endereco)}');
    }
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o mapa.')));
    }
  }

  Future<void> _desbloquearPedido(String pedidoId, String? chatId) async {
    if (_processandoPedidos.contains(pedidoId)) return;
    setState(() => _processandoPedidos.add(pedidoId));

    final user = FirebaseAuth.instance.currentUser;
    if (user == null) { setState(() => _processandoPedidos.remove(pedidoId)); return; }

    try {
      final docUser = await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
      final saldo = ((docUser.data()?['balance'] ?? 0) as num).toDouble();

      // ✅ Saldo insuficiente para R$1
      if (saldo < 1) {
        setState(() => _processandoPedidos.remove(pedidoId));
        if (!mounted) return;
        showDialog(context: context, builder: (_) => const PixDialog());
        return;
      }

      final uri = Uri.https('conectapro-backend-1.onrender.com', '/carteira/desbloquear');
      final response = await http.post(uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'userId': user.uid, 'pedidoId': pedidoId}),
      );

      if (response.statusCode != 200) throw Exception(response.body);
      final data = jsonDecode(response.body);

      if (data['success'] == true) {
        await FirebaseFirestore.instance.collection('requests').doc(pedidoId).update({
          'providerId': user.uid,
          'status': 'aceito',
          'acceptedAt': FieldValue.serverTimestamp(),
        });

        final chatFinal = (chatId != null && chatId.isNotEmpty) ? chatId : pedidoId;

        final pedidoDoc  = await FirebaseFirestore.instance.collection('requests').doc(pedidoId).get();
        final pedidoData = pedidoDoc.data() ?? {};
        final clienteId  = pedidoData['clienteId'] as String?;

        Map<String, dynamic> clienteData = {};
        if (clienteId != null && clienteId.isNotEmpty) {
          final clienteDoc = await FirebaseFirestore.instance.collection('users').doc(clienteId).get();
          clienteData = clienteDoc.data() ?? {};
        }

        final ruaPedido    = pedidoData['rua'] ?? '';
        final numeroPedido = pedidoData['numero'] ?? '';
        final bairroPedido = pedidoData['bairro'] ?? pedidoData['neighborhood'] ?? '';
        final cidadePedido = pedidoData['cidade'] ?? '';
        final estadoPedido = pedidoData['estado'] ?? '';
        final ruaComNumero = [
          if (ruaPedido.toString().isNotEmpty) ruaPedido,
          if (numeroPedido.toString().isNotEmpty) numeroPedido,
        ].join(', ');
        final localizacaoPedido = [
          if (ruaComNumero.isNotEmpty) ruaComNumero,
          if (bairroPedido.toString().isNotEmpty) bairroPedido,
          if (cidadePedido.toString().isNotEmpty)
            estadoPedido.toString().isNotEmpty ? '$cidadePedido/$estadoPedido' : cidadePedido,
        ].join(', ');

        final lat      = pedidoData['latitude'];
        final lng      = pedidoData['longitude'];
        final ratingRaw = clienteData['avaliacao'] ?? clienteData['rating'];

        if (!mounted) return;
        await _mostrarDialogContato(
          nome: clienteData['nome'] ?? 'Cliente',
          telefone: clienteData['phone'] ?? clienteData['telefone'] ?? '',
          endereco: localizacaoPedido,
          avaliacao: ratingRaw == null ? null : (ratingRaw as num).toDouble(),
          latitude:  lat == null ? null : (lat as num).toDouble(),
          longitude: lng == null ? null : (lng as num).toDouble(),
          chatId: chatFinal,
        );
      } else {
        throw Exception(data['message'] ?? 'Falha ao desbloquear.');
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.red.shade700));
    } finally {
      if (mounted) setState(() => _processandoPedidos.remove(pedidoId));
    }
  }

  Widget _buildEstrelas(double avaliacao) {
    final cheias  = avaliacao.floor();
    final temMeia = (avaliacao - cheias) >= 0.5;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (int i = 0; i < 5; i++)
          Icon(
            i < cheias ? Icons.star_rounded
                : (i == cheias && temMeia ? Icons.star_half_rounded : Icons.star_border_rounded),
            size: 16, color: _premiumGold,
          ),
        const SizedBox(width: 6),
        Text(avaliacao.toStringAsFixed(1).replaceAll('.', ','),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _black)),
      ],
    );
  }

  Future<void> _mostrarDialogContato({
    required String nome,
    required String telefone,
    required String endereco,
    required String chatId,
    double? avaliacao,
    double? latitude,
    double? longitude,
  }) {
    return showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => Dialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: const Color.fromRGBO(52, 199, 89, 0.12),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(Icons.check_circle, color: _verified, size: 26),
                  ),
                  const SizedBox(width: 12),
                  const Expanded(
                    child: Text('Contato desbloqueado!',
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: _black)),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Text('Cliente',
                  style: TextStyle(fontSize: 12, color: _textSecondary, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Row(
                children: [
                  Flexible(
                    child: Text(nome,
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: _black),
                        maxLines: 2, overflow: TextOverflow.ellipsis),
                  ),
                  const SizedBox(width: 6),
                  const Icon(Icons.verified_rounded, size: 17, color: _accent),
                ],
              ),
              const SizedBox(height: 4),
              const Row(
                children: [
                  Icon(Icons.check_circle_outline, size: 13, color: _textSecondary),
                  SizedBox(width: 4),
                  Text('Cliente verificado',
                      style: TextStyle(fontSize: 12, color: _textSecondary, fontWeight: FontWeight.w500)),
                ],
              ),
              if (avaliacao != null) ...[
                const SizedBox(height: 10),
                _buildEstrelas(avaliacao),
              ],
              const SizedBox(height: 16),
              if (telefone.isNotEmpty) ...[
                Row(
                  children: [
                    const Icon(Icons.phone, size: 16, color: _accent),
                    const SizedBox(width: 8),
                    Expanded(
                      child: SelectableText(telefone,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
              ],
              if (endereco.isNotEmpty) ...[
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Padding(
                      padding: EdgeInsets.only(top: 2),
                      child: Icon(Icons.location_on_outlined, size: 16, color: _accent),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(endereco,
                          style: const TextStyle(fontSize: 14, height: 1.3),
                          maxLines: 3, overflow: TextOverflow.ellipsis),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],
              Container(height: 1, color: const Color(0xFFEFEFF2)),
              const SizedBox(height: 12),
              // ✅ R$1,00 (não R$3,00)
              Row(
                children: const [
                  Icon(Icons.account_balance_wallet_outlined, size: 16, color: _textSecondary),
                  SizedBox(width: 8),
                  Expanded(
                    child: Text('R\$ 1,00 descontado do saldo',
                        style: TextStyle(fontSize: 12.5, color: _textSecondary, fontWeight: FontWeight.w500)),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: () {
                    Navigator.pop(ctx);
                    Navigator.push(context,
                        MaterialPageRoute(builder: (_) => ChatPage(chatId: chatId)));
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _black,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.chat_bubble_outline_rounded, size: 17, color: _white),
                      SizedBox(width: 8),
                      Text('Conversar com o cliente',
                          style: TextStyle(color: _white, fontSize: 14.5, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 10),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: endereco.isEmpty && latitude == null
                      ? null
                      : () => _abrirLocalizacao(lat: latitude, lng: longitude, endereco: endereco),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFE5E7EB)),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.map_outlined, size: 17, color: _black),
                      SizedBox(width: 8),
                      Text('Ver localização',
                          style: TextStyle(color: _black, fontSize: 14.5, fontWeight: FontWeight.w700)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return const Scaffold(body: Center(child: Text('Não logado')));

    return Scaffold(
      backgroundColor: _surface,
      appBar: _buildAppBar(),
      body: CustomScrollView(
        slivers: [
          SliverToBoxAdapter(child: _buildSaldoBanner(user)),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 20, 16, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    margin: const EdgeInsets.only(top: 6, right: 8),
                    width: 8, height: 8,
                    decoration: const BoxDecoration(color: _accent, shape: BoxShape.circle),
                  ),
                  const Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Pedidos disponíveis',
                            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800,
                                color: _black, letterSpacing: -0.3)),
                        SizedBox(height: 2),
                        Text('Novos serviços na sua região',
                            style: TextStyle(fontSize: 12.5, color: _textSecondary)),
                      ],
                    ),
                  ),
                  _buildFiltrarButton(),
                ],
              ),
            ),
          ),
          SliverFillRemaining(hasScrollBody: true, child: _buildListaPedidos(user)),
        ],
      ),
    );
  }

  Widget _buildFiltrarButton() {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Filtros chegando em breve ✨'),
            behavior: SnackBarBehavior.floating)),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: _white, borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFE5E7EB)),
          boxShadow: [BoxShadow(color: const Color.fromRGBO(0, 0, 0, 0.04), blurRadius: 6, offset: const Offset(0, 2))],
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Filtrar', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: _black)),
            SizedBox(width: 6),
            Icon(Icons.tune_rounded, size: 16, color: _black),
          ],
        ),
      ),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: _navyDark,
      foregroundColor: _white,
      elevation: 0,
      titleSpacing: 12,
      leading: const Padding(
        padding: EdgeInsets.only(left: 16),
        child: Icon(Icons.menu_rounded, size: 22),
      ),
      leadingWidth: 46,
      title: const Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Text('Conecta', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19, letterSpacing: -0.3, color: _white)),
          Text('Pro',     style: TextStyle(fontWeight: FontWeight.w800, fontSize: 19, letterSpacing: -0.3, color: _accent)),
        ],
      ),
      actions: [
        IconButton(icon: const Icon(Icons.history_rounded, size: 22), tooltip: 'Histórico',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => HistoricoServicosPage()))),
        IconButton(icon: const Icon(Icons.work_outline_rounded, size: 22), tooltip: 'Meus serviços',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => MeusServicosPage()))),
        Stack(
          clipBehavior: Clip.none,
          children: [
            IconButton(
              icon: const Icon(Icons.account_balance_wallet_outlined, size: 22),
              tooltip: 'Adicionar saldo',
              onPressed: () => showDialog(context: context, builder: (_) => const PixDialog()),
            ),
            Positioned(
              top: 9, right: 9,
              child: Container(
                width: 8, height: 8,
                decoration: BoxDecoration(
                  color: _accent, shape: BoxShape.circle,
                  border: Border.all(color: _navyDark, width: 1.5),
                ),
              ),
            ),
          ],
        ),
        IconButton(icon: const Icon(Icons.person_outline_rounded, size: 22), tooltip: 'Meu perfil',
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const MeuPerfilProfissionalPage()))),
        IconButton(icon: const Icon(Icons.help_outline_rounded, size: 22), tooltip: 'Ajuda',
            onPressed: _abrirSuporte),
        IconButton(
          icon: const Icon(Icons.logout_rounded, size: 22),
          tooltip: 'Sair',
          onPressed: () async {
            await FirebaseAuth.instance.signOut();
            if (!mounted) return;
            Navigator.of(context).pushAndRemoveUntil(
              MaterialPageRoute(builder: (_) => const AuthCheck()), (route) => false);
          },
        ),
        const SizedBox(width: 4),
      ],
    );
  }

  Widget _buildSaldoBanner(User user) {
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
      builder: (context, snap) {
        double saldo = 0;
        if (snap.hasData && snap.data!.exists) {
          final d = snap.data!.data() as Map<String, dynamic>;
          saldo = ((d['balance'] ?? 0) as num).toDouble();
        }
        return Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft, end: Alignment.bottomRight,
              colors: [_navyDark, _navyLight],
            ),
            borderRadius: BorderRadius.circular(24),
            boxShadow: [BoxShadow(color: const Color.fromRGBO(10, 10, 20, 0.25), blurRadius: 20, offset: const Offset(0, 10))],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(24),
            child: Stack(
              children: [
                Positioned(right: -30, top: -30,
                  child: Container(width: 130, height: 130,
                    decoration: BoxDecoration(shape: BoxShape.circle,
                      border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.06), width: 18)))),
                Positioned(right: 10, top: 40,
                  child: Container(width: 70, height: 70,
                    decoration: BoxDecoration(shape: BoxShape.circle,
                      border: Border.all(color: const Color.fromRGBO(255, 255, 255, 0.05), width: 10)))),
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Container(
                            width: 52, height: 52,
                            decoration: BoxDecoration(color: _accent, borderRadius: BorderRadius.circular(16)),
                            child: const Icon(Icons.account_balance_wallet_rounded, color: _white, size: 26),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const Text('Seu saldo disponível',
                                    style: TextStyle(color: Color(0xFFB8BAC9), fontSize: 13, fontWeight: FontWeight.w500)),
                                const SizedBox(height: 2),
                                Text('R\$ ${saldo.toStringAsFixed(2).replaceAll('.', ',')}',
                                    style: const TextStyle(color: _white, fontSize: 28,
                                        fontWeight: FontWeight.w800, letterSpacing: -0.5)),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      InkWell(
                        borderRadius: BorderRadius.circular(24),
                        onTap: () => showDialog(context: context, builder: (_) => const PixDialog()),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 11),
                          decoration: BoxDecoration(color: _accent, borderRadius: BorderRadius.circular(24)),
                          child: const Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Text('Adicionar saldo',
                                  style: TextStyle(color: _white, fontSize: 14, fontWeight: FontWeight.w700)),
                              SizedBox(width: 6),
                              Icon(Icons.add_circle_rounded, color: _white, size: 18),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 18),
                      Container(height: 1, color: const Color.fromRGBO(255, 255, 255, 0.08)),
                      const SizedBox(height: 16),
                      Row(
                        children: [
                          Container(
                            width: 40, height: 40,
                            decoration: BoxDecoration(
                              color: const Color.fromRGBO(255, 201, 77, 0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Icon(Icons.diamond_rounded, color: _premiumGold, size: 20),
                          ),
                          const SizedBox(width: 12),
                          const Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('Carteira Premium',
                                    style: TextStyle(color: _white, fontSize: 14, fontWeight: FontWeight.w700)),
                                SizedBox(height: 2),
                                Text('Desbloqueie contatos e conquiste mais serviços!',
                                    style: TextStyle(color: Color(0xFFB8BAC9), fontSize: 11.5, height: 1.3)),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildListaPedidos(User user) {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('requests')
          .where('status', isEqualTo: 'aberto')
          .orderBy('criadoEm', descending: true)
          .snapshots(),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting)
          return const Center(child: CircularProgressIndicator(color: _accent));
        if (snap.hasError)
          return Center(child: Text('Erro: ${snap.error}', style: const TextStyle(color: Colors.red)));

        final docs = snap.data?.docs ?? [];
        final temServicoAtivo = docs.any((d) {
          final data = d.data() as Map<String, dynamic>;
          return data['providerId'] == user.uid && data['status'] == 'aceito';
        });
        final pedidos = docs.where((d) {
          final data = d.data() as Map<String, dynamic>;
          return data['providerId'] == null || (data['providerId'] as String).isEmpty;
        }).toList();

        if (pedidos.isEmpty) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 84, height: 84,
                  decoration: const BoxDecoration(color: Color(0xFFEDEFF5), shape: BoxShape.circle),
                  child: const Icon(Icons.inbox_outlined, size: 38, color: _textSecondary),
                ),
                const SizedBox(height: 16),
                const Text('Nenhum pedido disponível',
                    style: TextStyle(fontSize: 16, color: _black, fontWeight: FontWeight.w700)),
                const SizedBox(height: 4),
                const Text('Novos pedidos aparecerão aqui automaticamente.',
                    style: TextStyle(fontSize: 13, color: _textSecondary)),
              ],
            ),
          );
        }

        return RefreshIndicator(
          color: _accent,
          onRefresh: () async => setState(() {}),
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
            itemCount: pedidos.length,
            separatorBuilder: (_, __) => const SizedBox(height: 14),
            itemBuilder: (context, index) {
              final doc  = pedidos[index];
              final data = doc.data() as Map<String, dynamic>;
              _registrarVisualizacao(doc.id);
              return _buildCardPedido(doc.id, data, temServicoAtivo);
            },
          ),
        );
      },
    );
  }

  String _tempoDecorrido(dynamic criadoEm) {
    if (criadoEm == null || criadoEm is! Timestamp) return '';
    final diff = DateTime.now().difference(criadoEm.toDate());
    if (diff.inMinutes < 1)  return 'agora mesmo';
    if (diff.inMinutes < 60) return 'há ${diff.inMinutes} min';
    if (diff.inHours < 24)   return 'há ${diff.inHours}h';
    return 'há ${diff.inDays}d';
  }

  String? _formatarDistancia(Map<String, dynamic> data) {
    if (_minhaLat == null || _minhaLng == null) return null;
    final lat = data['latitude'];
    final lng = data['longitude'];
    if (lat == null || lng == null) return null;
    final km = Geolocator.distanceBetween(_minhaLat!, _minhaLng!,
        (lat as num).toDouble(), (lng as num).toDouble()) / 1000;
    return '${km.toStringAsFixed(km < 10 ? 1 : 0).replaceAll('.', ',')} km';
  }

  Widget _buildCardPedido(String pedidoId, Map<String, dynamic> data, bool temServicoAtivo) {
    final titulo      = data['titulo'] ?? data['title'] ?? 'Serviço sem título';
    final descricao   = data['descricao'] ?? data['description'] ?? '';
    final categoria   = (data['categoria'] ?? data['category'] ?? '').toString();
    final bairro      = data['bairro'] ?? data['neighborhood'] ?? '';
    final cidade      = data['cidade'] ?? '';
    final estado      = data['estado'] ?? '';
    final localizacao = [
      if (bairro.toString().isNotEmpty) bairro,
      if (cidade.toString().isNotEmpty)
        estado.toString().isNotEmpty ? '$cidade/$estado' : cidade,
    ].join(', ');
    final chatId        = data['chatId'] as String?;
    final isProcessando = _processandoPedidos.contains(pedidoId);
    final isFavorito    = _favoritos.contains(pedidoId);
    final tempo         = _tempoDecorrido(data['criadoEm']);
    final distancia     = _formatarDistancia(data);
    final recente       = _isRecente(data['criadoEm']);
    final valorMin      = data['valorEstimadoMin'];
    final valorMax      = data['valorEstimadoMax'];
    final temValor      = valorMin != null && valorMax != null;
    final visualizacoes = ((data['visualizacoes'] ?? 0) as num).toInt();
    final estilo        = _categoriaEstilo(categoria);
    final Color corCategoria   = estilo['cor'] as Color;
    final IconData iconeCategoria = estilo['icone'] as IconData;

    return Container(
      decoration: BoxDecoration(
        color: _white,
        borderRadius: BorderRadius.circular(18),
        boxShadow: [BoxShadow(color: const Color.fromRGBO(15, 15, 30, 0.06), blurRadius: 16, offset: const Offset(0, 6))],
      ),
      clipBehavior: Clip.antiAlias,
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 4, color: corCategoria),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [

                  // ── Cabeçalho ──────────────────────────────────────────────
                  Padding(
                    padding: const EdgeInsets.fromLTRB(14, 16, 12, 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 46, height: 46,
                          decoration: BoxDecoration(color: corCategoria, borderRadius: BorderRadius.circular(13)),
                          child: Icon(iconeCategoria, color: _white, size: 24),
                        ),
                        const SizedBox(width: 12),
                        // ✅ Expanded garante que título não vaze da caixa
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(titulo,
                                  style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: _black),
                                  maxLines: 2,                        // ✅ até 2 linhas antes de cortar
                                  overflow: TextOverflow.ellipsis),
                              if (categoria.isNotEmpty) ...[
                                const SizedBox(height: 4),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                  decoration: BoxDecoration(
                                    color: corCategoria.withOpacity(0.10),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Text(categoria,
                                      style: TextStyle(fontSize: 11, color: corCategoria, fontWeight: FontWeight.w700),
                                      maxLines: 1,                    // ✅ categoria nunca vaza
                                      overflow: TextOverflow.ellipsis),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 6),
                        // ✅ badge "Novo" + favorito em Column para não empurrar o título
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            if (recente)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                                decoration: BoxDecoration(
                                  color: const Color.fromRGBO(47, 111, 237, 0.10),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: const Text('Novo',
                                    style: TextStyle(fontSize: 11, color: _accent, fontWeight: FontWeight.w700)),
                              ),
                            InkWell(
                              borderRadius: BorderRadius.circular(20),
                              onTap: () => setState(() {
                                if (isFavorito) _favoritos.remove(pedidoId);
                                else _favoritos.add(pedidoId);
                              }),
                              child: Padding(
                                padding: const EdgeInsets.all(4),
                                child: Icon(
                                  isFavorito ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                                  size: 20,
                                  color: isFavorito ? const Color(0xFFEF4444) : const Color(0xFFC4C6D0),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),

                  // ── Localização + tempo ────────────────────────────────────
                  if (localizacao.isNotEmpty || tempo.isNotEmpty)
                    Padding(
                      padding: EdgeInsets.fromLTRB(14, 0, 14, distancia != null ? 2 : 8),
                      child: Row(
                        children: [
                          if (localizacao.isNotEmpty) ...[
                            const Icon(Icons.location_on_outlined, size: 13, color: _textSecondary),
                            const SizedBox(width: 2),
                            Expanded(
                              child: Text(localizacao,
                                  style: const TextStyle(fontSize: 12, color: _textSecondary),
                                  maxLines: 1, overflow: TextOverflow.ellipsis),  // ✅
                            ),
                          ],
                          if (localizacao.isNotEmpty && tempo.isNotEmpty)
                            const Text('  ·  ', style: TextStyle(fontSize: 12, color: _textSecondary)),
                          if (tempo.isNotEmpty)
                            Text(tempo, style: const TextStyle(fontSize: 12, color: _textSecondary)),
                        ],
                      ),
                    ),

                  // ── Distância ──────────────────────────────────────────────
                  if (distancia != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 0, 14, 8),
                      child: Row(
                        children: [
                          const Icon(Icons.directions_car_filled_outlined, size: 13, color: _textSecondary),
                          const SizedBox(width: 2),
                          Text(distancia, style: const TextStyle(fontSize: 12, color: _textSecondary)),
                        ],
                      ),
                    ),

                  const Divider(color: Color(0xFFEFEFF2), height: 1, indent: 14, endIndent: 14),

                  // ── Descrição ──────────────────────────────────────────────
                  if (descricao.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
                      child: Text(descricao,
                          style: const TextStyle(fontSize: 13.5, color: _textSecondary, height: 1.45),
                          maxLines: 3, overflow: TextOverflow.ellipsis),   // ✅
                    ),

                  // ── Valor estimado + interessados ──────────────────────────
                  if (temValor || visualizacoes > 0)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          if (temValor)
                            Flexible(                                  // ✅ Flexible evita overflow
                              child: Text(
                                'R\$ ${(valorMin as num).toStringAsFixed(0)} - ${(valorMax as num).toStringAsFixed(0)}',
                                style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w800, color: Color(0xFF16A34A)),
                                maxLines: 1, overflow: TextOverflow.ellipsis,
                              ),
                            )
                          else
                            const SizedBox.shrink(),
                          if (visualizacoes > 0)
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Text('🔥', style: TextStyle(fontSize: 12)),
                                const SizedBox(width: 3),
                                Text(
                                  visualizacoes > 1 ? '$visualizacoes interessados' : '1 interessado',
                                  style: const TextStyle(fontSize: 11.5, color: Color(0xFFEA580C), fontWeight: FontWeight.w700),
                                ),
                              ],
                            ),
                        ],
                      ),
                    ),

                  // ── Aviso serviço ativo ────────────────────────────────────
                  if (temServicoAtivo)
                    const Padding(
                      padding: EdgeInsets.fromLTRB(14, 10, 14, 0),
                      child: Row(
                        children: [
                          Icon(Icons.warning_amber_rounded, size: 14, color: Color(0xFFFF9500)),
                          SizedBox(width: 6),
                          Expanded(                                    // ✅ Expanded no aviso
                            child: Text('Finalize seu serviço atual primeiro',
                                style: TextStyle(fontSize: 12, color: Color(0xFFFF9500), fontWeight: FontWeight.w600),
                                maxLines: 1, overflow: TextOverflow.ellipsis),
                          ),
                        ],
                      ),
                    ),

                  // ── Botão desbloquear ──────────────────────────────────────
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: SizedBox(
                      width: double.infinity,
                      height: 50,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: temServicoAtivo ? const Color(0xFFCCCCCC) : _black,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          elevation: 0,
                        ),
                        onPressed: (isProcessando || temServicoAtivo)
                            ? null
                            : () => _desbloquearPedido(pedidoId, chatId),
                        child: isProcessando
                            ? const SizedBox(width: 20, height: 20,
                                child: CircularProgressIndicator(color: _white, strokeWidth: 2))
                            : Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.lock_open_rounded, size: 18, color: _white),
                                  const SizedBox(width: 8),
                                  const Flexible(                      // ✅ Flexible no texto do botão
                                    child: Text('Desbloquear contato',
                                        style: TextStyle(color: _white, fontSize: 14, fontWeight: FontWeight.w700),
                                        maxLines: 1, overflow: TextOverflow.ellipsis),
                                  ),
                                  const SizedBox(width: 6),
                                  // ✅ R$1,00 (não R$3,00)
                                  Text('R\$ 1,00',
                                      style: TextStyle(
                                          color: _accent.withOpacity(0.9),
                                          fontSize: 14,
                                          fontWeight: FontWeight.w800)),
                                ],
                              ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
