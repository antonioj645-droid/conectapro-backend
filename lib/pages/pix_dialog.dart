import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

class PixDialog extends StatefulWidget {
  final double valor;

  const PixDialog({
    super.key,
    required this.valor,
  });

  @override
  State<PixDialog> createState() => _PixDialogState();
}

class _PixDialogState extends State<PixDialog> {

  bool loading = true;
  bool pagamentoConfirmado = false;

  String pixCopiaCola = '';
  String paymentId = '';

  Uint8List? qrCodeImage;

  static const String baseUrl =
      'https://conectapro-backend-1.onrender.com';

  @override
  void initState() {
    super.initState();
    gerarPix();
  }

  // ================================
  // GERAR PIX (CORRIGIDO)
  // ================================
  Future<void> gerarPix() async {
    try {

      final response = await http.post(
        Uri.parse('$baseUrl/pix/criar-pix'),
        headers: {
          'Content-Type': 'application/json',
        },
        body: jsonEncode({
          'valor': widget.valor,
          'email': 'cliente@gmail.com',
          'nome': 'Antonio'
        }),
      ).timeout(const Duration(seconds: 20));

      if (response.statusCode != 200) {
        throw Exception('Erro HTTP ${response.statusCode}');
      }

      final data = jsonDecode(response.body);

      Uint8List? qrTemp;

      final rawQr =
          data['qrCodeBase64'] ?? data['encodedImage'] ?? '';

      if (rawQr.isNotEmpty) {
        try {
          final clean = rawQr.contains(',')
              ? rawQr.split(',').last
              : rawQr;

          qrTemp = base64Decode(clean);
        } catch (e) {
          debugPrint("Erro decode QR: $e");
        }
      }

      if (!mounted) return;

      setState(() {
        pixCopiaCola = data['pixCopiaECola'] ?? '';
        paymentId    = data['paymentId'] ?? '';
        qrCodeImage  = qrTemp;
        loading      = false;
      });

      iniciarVerificacaoPagamento();

    } catch (e) {
      if (!mounted) return;

      setState(() {
        loading = false;
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Erro PIX: $e')),
      );
    }
  }

  // ================================
  // COPIAR PIX
  // ================================
  Future<void> copiarPix() async {
    await Clipboard.setData(
      ClipboardData(text: pixCopiaCola),
    );

    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('PIX copiado')),
    );
  }

  // ================================
  // VERIFICAR PAGAMENTO
  // ================================
  Future<void> iniciarVerificacaoPagamento() async {

    int tentativas = 0;

    while (!pagamentoConfirmado) {

      if (tentativas > 60) {
        debugPrint("Timeout pagamento");
        break;
      }

      await Future.delayed(
        const Duration(seconds: 5),
      );

      try {
        final response = await http.get(
          Uri.parse('$baseUrl/pix/verificar-pagamento/$paymentId'),
        );

        if (response.statusCode != 200) continue;

        final data = jsonDecode(response.body);
        final status = data['status'] ?? '';

        if (status == 'RECEIVED' || status == 'CONFIRMED') {

          if (!mounted) return;

          setState(() {
            pagamentoConfirmado = true;
          });

          HapticFeedback.mediumImpact();

          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Pagamento confirmado'),
            ),
          );

          Navigator.pop(context, true);

          break;
        }

      } catch (e) {
        debugPrint('Erro verificar pagamento: $e');
      }

      tentativas++;
    }
  }

  // ================================
  // UI
  // ================================
  @override
  Widget build(BuildContext context) {

    return Dialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(24),
      ),
      child: Container(
        width: 420,
        padding: const EdgeInsets.all(24),

        child: loading
            ? const SizedBox(
                height: 350,
                child: Center(
                  child: CircularProgressIndicator(),
                ),
              )

            : SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [

                    const Text(
                      'Pagamento PIX',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 12),

                    Text(
                      'R\$ ${widget.valor.toStringAsFixed(2)}',
                      style: const TextStyle(
                        fontSize: 36,
                        color: Colors.green,
                        fontWeight: FontWeight.bold,
                      ),
                    ),

                    const SizedBox(height: 24),

                    if (qrCodeImage != null)
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: Colors.grey.shade300,
                          ),
                          borderRadius: BorderRadius.circular(18),
                        ),
                        child: Image.memory(
                          qrCodeImage!,
                          width: 220,
                          height: 220,
                          fit: BoxFit.contain,
                        ),
                      ),

                    const SizedBox(height: 24),

                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.orange.shade50,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: const [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                            ),
                          ),
                          SizedBox(width: 12),
                          Text('Aguardando pagamento...'),
                        ],
                      ),
                    ),

                    const SizedBox(height: 20),

                    SelectableText(
                      pixCopiaCola,
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 11),
                    ),

                    const SizedBox(height: 20),

                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: ElevatedButton.icon(
                        onPressed: copiarPix,
                        icon: const Icon(Icons.copy),
                        label: const Text('Copiar código PIX'),
                        style: ElevatedButton.styleFrom(
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}