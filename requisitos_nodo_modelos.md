# REQUISITOS TÉCNICOS: PLATAFORMA DE GENERACIÓN VIDEO A VIDEO (VIDEO2VIDEO) BASADA EN NODOS

**Versión del Documento:** 2.0  
**Enfoque Tecnológico:** Modelos Diffusion Transformers (DiT) espaciotemporales (Wan2.1, Wan2.2, Sora-architectures, CogVideoX, LTX-Video).  
**Arquitectura del Sistema:** Motor modular desacoplado basado en Grafos Dirigidos Acíclicos (DAG) con nodos independientes de entrada, procesamiento y previsualización.

---

## 1. RESUMEN EJECUTIVO Y ARQUITECTURA GENERAL

El objetivo de este proyecto es construir una aplicación que permita la manipulación y transformación de secuencias de video mediante inteligencia artificial generativa, utilizando una interfaz visual orientada a nodos. El núcleo del sistema sustituye los antiguos enfoques basados en redes U-Net por arquitecturas **DiT (Diffusion Transformers)** avanzadas, las cuales procesan el contenido audiovisual como tokens o parches en un espacio latente tridimensional.

La aplicación operará bajo el principio de un flujo de datos continuo donde cada nodo realiza una única tarea especializada (cargar video, codificar audio, inyectar prompts, procesar la difusión, renderizar el resultado).

---

## 2. REQUISITOS GENERALES PARA CUALQUIER MODELO DiT (DIFFUSION TRANSFORMER)

Para garantizar que la plataforma sea agnóstica y escalable frente a cualquier modelo DiT actual o futuro enfocado en video (Wan, Flux, LTX, Sora), el core del motor debe cumplir estrictamente con los siguientes estándares arquitectónicos:

### A. Representación de Datos: El Pipeline de Parches (Patchification)
A diferencia del texto (1D) o las imágenes (2D), el video requiere un tratamiento en tres dimensiones (Espacio y Tiempo).
* **Módulo de Tokenización Espaciotemporal:** El sistema debe procesar los latentes del video segmentándolos en cubos de parches (ej. bloques de $2 \times 2 \times 2$ o $4 \times 4 \times 4$ que agrupan píxeles y fotogramas consecutivos).
* **Incrustaciones de Posición 3D (RoPE / 3D Position Embeddings):** El motor matemático debe implementar de forma nativa capas de incrustación posicional rotatoria tridimensionales ($X, Y, T$). Esto es indispensable para que las capas de atención del modelo comprendan tanto la geometría interna de un fotograma como la continuidad cronológica del movimiento.

### B. Gestión de Cómputo y Memoria para Transformadores
Los modelos DiT escalan de forma cuadrática respecto a la longitud de la secuencia (Frames $\times$ Alto $\times$ Ancho). Su despliegue requiere:
* **Soporte Obligatorio de Atención Kernelizada:** El entorno de software debe integrar kernels optimizados como `FlashAttention-3`, `SageAttention` o `Fused Attention`. El uso de la atención de producto escalar nativa de PyTorch causará un desbordamiento inmediato de VRAM (Out Of Memory - OOM).
* **Paralelismo de Secuencia / Contexto (Context Parallelism):** Para modelos DiT que excedan los 5B de parámetros ejecutando resoluciones HD, el software debe ser capaz de segmentar de forma transparente la dimensión temporal (los frames) distribuyendo los tokens de atención a lo largo de múltiples GPUs interconectadas por NVLink o InfiniBand.

### C. Flexibilidad de Acondicionamiento y Muestreo
* **Acondicionamiento Multi-Modal Adaptativo:** Los bloques de construcción del DiT deben soportar configuraciones basadas en normalización de capa adaptativa (`adaLN-single` / `adaLN-modulation`) o Cross-Attention pura. El nodo del modelo debe aceptar flujos heterogéneos de texto, embeddings visuales y vectores acústicos.
* **Mecanismo de Guía de Flujo (Flow Matching / Rectified Flow):** La plataforma de muestreo (Scheduler) debe estar diseñada para integradores de ecuaciones diferenciales ordinarias (EDOs) lineales. Esto permite migrar de la difusión tradicional a la técnica de *Rectified Flow* (característica clave en Wan2.2 y Flux), logrando reducir los pasos de inferencia de 50 a solo 20-30 con resultados comerciales fotorrealistas.
* **Manejo de Ratios Nativos (Aspect Ratio Bucketing):** Se prohíbe el reescalado forzado o recorte destructivo de los videos de entrada. El tokenizador del sistema debe empaquetar parches de aspecto variable de forma dinámica (similar a la estrategia *NaViT*) para mantener las composiciones originales (16:9, 9:16, 21:9).

---

## 3. REQUISITOS ESPECÍFICOS DEL NODO "VIDEO2VIDEO (WAN2.2)"

Este nodo representa el procesador central del grafo. Su función es recibir todos los inputs periféricos, orquestar los componentes del modelo base y despachar el tensor latente de video transformado.

### Conectores de Entrada (Inputs del Nodo)
* **`video_input` (Secuencia / Tensor):** Recibe la secuencia de fotogramas originales codificados como píxeles RGB o un flujo latente proveniente de un nodo VAE previo.
* **`positive_prompt` (Texto):** Cadena de texto descriptiva que guía la dirección creativa de la transformación (estilo, iluminación, mutación de objetos).
* **`negative_prompt` (Texto):** Elementos estéticos o técnicos proscritos (ej. *deformidades, parpadeo de texturas, baja resolución*).
* **`audio_input` (Audio Features - Opcional):** Vector matemático de características de audio (procesado previamente por redes tipo Whisper) para guiar la modulación del ritmo visual en modelos Wan orientados a la sincronización sonora.
* **`denoising_strength` (Float, Rango: 0.0 a 1.0):** Parámetro crítico que controla el nivel de mutación. Un valor inferior a `0.3` preserva los rostros y texturas originales aplicando solo filtros ligeros. Un valor superior a `0.75` redibuja la escena por completo, preservando únicamente las dinámicas de movimiento masivo.
* **Controles de Muestreo:** `seed` (semilla), `steps` (iteraciones), y `cfg_scale` (fuerza del clasificador libre de guía).

### Lógica Interna del Nodo
1.  **Codificación de Texto:** Traduce el `positive_prompt` a vectores multidimensionales a través del Text Encoder T5-XXL.
2.  **Inyección de Ruido Controlado:** Toma el video origen, lo pasa por el *Video VAE Encoder* (comprimiéndolo de forma espacial y temporal) y le introduce un volumen de ruido gaussiano directamente proporcional al valor de `denoising_strength`.
3.  **Inferencia en Bloques DiT:** Inicia el bucle de difusión donde el Transformer remueve el ruido paso a paso, aplicando de manera simultánea atención espacial interna y atención temporal entre fotogramas para asegurar coherencia fluida y cero parpadeos (*flickering*).
4.  **Decodificación:** Convierte el latente purificado a través del *Video VAE Decoder* para retornar una matriz estándar de píxeles visuales.

### Conectores de Salida (Outputs del Nodo)
* **`video_output`:** Despacha la secuencia de fotogramas resultante hacia nodos de salida visual, guardado en disco o pipelines secundarios de post-procesamiento.
* **`video_preview`:** Nodo donde despliega un video preview para la visualización rápida y interactiva del proceso de difusión.

---

## 4. REQUISITOS DE INFRAESTRUCTURA DE CÓMPUTO (HARDWARE)

La computación necesaria se divide estrictamente según el objetivo operativo del entorno:

| Parámetro / Componente | Fase de Inferencia en Producción | Fase de Ajuste Fino (Fine-Tuning / LoRA) |
| :--- | :--- | :--- |
| **GPU Recomendada** | NVIDIA RTX 4090 (Desarrollo local)<br>NVIDIA L40S / A100 (Producción SaaS) | NVIDIA A100 (80GB) / H100 / H200 (Configuración multi-nodo) |
| **VRAM Mínima por Tarjeta** | 16 GB (Utilizando cuantización FP8)<br>24 GB - 40 GB (Precisión nativa FP16) | 80 GB de VRAM por nodo como requerimiento mínimo para evitar colapsos por falta de memoria. |
| **Memoria RAM del Sistema**| Mínimo 64 GB RAM | Mínimo 256 GB - 512 GB RAM |
| **Interconexión de Red** | PCIe Gen 4 o superior | NVIDIA NVLink (900 GB/s) a nivel interno + InfiniBand (400 Gbps) para clústeres. |
| **Almacenamiento masivo** | SSD NVMe (Mínimo 1 TB libre para almacenamiento local de múltiples checkpoints). | Arreglos NVMe distribuidos de alta velocidad (Ceph/WEKA) > 10 TB. |

---

## 5. REQUISITOS DEL ENTORNO DE SOFTWARE Y DEPENDENCIAS

El entorno de ejecución del servidor o backend debe correr de manera aislada mediante contenedores Docker para garantizar la paridad entre desarrollo y producción:

* **Sistema Operativo Base:** Ubuntu 22.04 LTS o superior.
* **Capa de Control de GPU:** CUDA Toolkit 12.1 o superior.
* **Framework de IA:** PyTorch 2.3+ (con soporte avanzado para compilación nativa vía `torch.compile`).
* **Librerías de Aceleración Críticas:** `FlashAttention-2/3`, `xFormers` y `bitsandbytes` (para control de cuantización).
* **Ecosistema Generativo:** Hugging Face `diffusers`, `transformers` y `accelerate`.
* **Framework de Cómputo Distribuido:** DeepSpeed (ZeRO-2/ZeRO-3) o Megatron-LM para división de pesos de modelos gigantescos en fases de entrenamiento.

---

## 6. PROGRAMA CENTRAL (ARQUITECTURA DEL MOTOR POR NODOS EN PYTHON)

El siguiente script funcional implementa la arquitectura lógica de la aplicación. Controla la lectura, la transferencia de tipos de datos complejos (video, audio, prompts), el procesamiento acoplado al modelo Wan2.2 y la salida hacia los monitores de visualización.

```python
import torch
import numpy as np
from typing import Dict, Any, List

# =====================================================================
# INTERFAZ O BACKEND DE CONTROL DEL MODELO WAN2.2 / DiT CORE
# =====================================================================
class Wan2_2PipelineBackend:
    """Clase encargada de interactuar directamente con la GPU y el modelo Wan2.2"""
    def __init__(self):
        print("[INFO] Cargando componentes de Wan2.2 (VAE, DiT, T5 Text Encoder)...")
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
    def generate_v2v(self, init_video: torch.Tensor, prompt: str, negative_prompt: str, 
                     denoising_strength: float, steps: int, audio: torch.Tensor = None) -> torch.Tensor:
        print(f"\n[Backend Wan2.2] Iniciando proceso Video2Video en dispositivo: {self.device}")
        print(f"[Backend Wan2.2] Dimensiones del video base: {list(init_video.shape)}")
        print(f"[Backend Wan2.2] Aplicando Prompt: '{prompt}'")
        
        if audio is not None:
            print(f"[Backend Wan2.2] Sincronizando generación con pista de audio integrada.")

        # 1. Simulación de codificación en espacio latente VAE (Patchification y reducción de dimensionalidad)
        latent = init_video * 0.5  
        
        # 2. Simulación de Loop de Muestreo en el Transformer (DiT) aplicando Denoising Strength
        print(f"[Backend Wan2.2] Ejecutando {steps} pasos de muestreo con Denoising: {denoising_strength}")
        noise = torch.randn_like(latent)
        generated_latent = latent * (1.0 - denoising_strength) + noise * denoising_strength
        
        # 3. Decodificación del espacio latente de vuelta a espacio de píxeles RGB
        output_frames = generated_latent * 2.0
        return output_frames


# =====================================================================
# ARQUITECTURA BASE DEL SISTEMA DE NODOS (ORQUESTADOR)
# =====================================================================
class BaseNode:
    """Clase base de la que heredan todos los bloques funcionales de la app"""
    def __init__(self, name: str):
        self.name = name
        self.inputs: Dict[str, Any] = {}
        self.outputs: Dict[str, Any] = {}

    def connect_input(self, input_key: str, source_node: 'BaseNode', output_key: str):
        """Conecta la salida de un nodo a la entrada de este nodo (Equivale a tirar un cable en la UI)"""
        self.inputs[input_key] = (source_node, output_key)

    def get_input_value(self, input_key: str, default: Any = None) -> Any:
        """Resuelve dinámicamente el valor del nodo conectado en el grafo"""
        if input_key in self.inputs:
            source_node, output_key = self.inputs[input_key]
            return source_node.outputs.get(output_key)
        return default

    def execute(self):
        raise NotImplementedError


# =====================================================================
# IMPLEMENTACIÓN DE LOS NODOS REQUERIDOS
# =====================================================================
class VideoInputNode(BaseNode):
    """Nodo encargado de cargar un video original o una secuencia de imágenes"""
    def __init__(self, name: str, file_path: str):
        super().__init__(name)
        self.file_path = file_path

    def execute(self):
        print(f"[{self.name}] Cargando video y decodificando fotogramas desde: {self.file_path}")
        # Simulamos un video cargado como un tensor: [Frames: 24, Canales: 3, Alto: 512, Ancho: 512]
        self.outputs["video_stream"] = torch.rand(24, 3, 512, 512)


class AudioInputNode(BaseNode):
    """Nodo encargado de cargar y procesar archivos de sonido para condicionar el video"""
    def __init__(self, name: str, file_path: str):
        super().__init__(name)
        self.file_path = file_path

    def execute(self):
        print(f"[{self.name}] Instanciando archivo de sonido desde: {self.file_path}")
        # Simulamos un vector de características de audio extraído por un modelo como Whisper
        self.outputs["audio_features"] = torch.rand(1, 1024)


class PromptTextNode(BaseNode):
    """Nodo que almacena y transfiere las cadenas de texto (Prompts)"""
    def __init__(self, name: str, text: str):
        super().__init__(name)
        self.text = text

    def execute(self):
        print(f"[{self.name}] Procesando Prompt: \"{self.text}\"")
        self.outputs["text_output"] = self.text


class Wan2_2V2VNode(BaseNode):
    """EL NODO CENTRAL: Recopila todas las entradas y corre el modelo Wan2.2"""
    def __init__(self, name: str, backend: Wan2_2PipelineBackend):
        super().__init__(name)
        self.backend = backend
        # Ajustes internos editables en la interfaz del nodo
        self.steps = 35
        self.denoising_strength = 0.65

    def execute(self):
        print(f"\n[{self.name}] Recolectando entradas de los nodos conectados...")
        
        # Resolución dinámica de conexiones
        video_data = self.get_input_value("video_in")
        positive_prompt = self.get_input_value("prompt_pos", "")
        negative_prompt = self.get_input_value("prompt_neg", "low quality, blur")
        audio_data = self.get_input_value("audio_in", None)
        
        if video_data is None:
            raise ValueError(f"Error fatal en {self.name}: El conector 'video_in' no tiene nada vinculado.")

        # Invocación del backend del modelo DiT
        generated_tensor = self.backend.generate_v2v(
            init_video=video_data,
            prompt=positive_prompt,
            negative_prompt=negative_prompt,
            denoising_strength=self.denoising_strength,
            steps=self.steps,
            audio=audio_data
        )
        
        # Mapeo del resultado a la salida del nodo
        self.outputs["video_out"] = generated_tensor


class VideoPreviewNode(BaseNode):
    """Nodo de salida que toma el flujo generado y simula el renderizado en la interfaz"""
    def execute(self):
        final_video = self.get_input_value("video_to_preview")
        if final_video is not None:
            print(f"\n[{self.name}] ¡Flujo de video recibido de forma correcta!")
            print(f"-> Mostrando en ventana de Preview una secuencia de {final_video.shape[0]} frames procesados.")
        else:
            print(f"[{self.name} Error] No se ha recibido ninguna señal de video para reproducir.")


# =====================================================================
# ORQUESTACIÓN DEL FLUJO (GRAFO EN TIEMPO DE EJECUCIÓN)
# =====================================================================
if __name__ == "__main__":
    print("=== INICIALIZANDO ENTORNO CORE BASADO EN NODOS ===\n")
    
    # 1. Instanciar el backend del modelo (se mantiene una vez en memoria global)
    wan_core = Wan2_2PipelineBackend()

    # 2. Creación e instanciación de los nodos en el lienzo (Canvas)
    node_video = VideoInputNode("Load_Video_01", "secuencia_origen.mp4")
    node_audio = AudioInputNode("Load_Audio_01", "banda_sonora.wav")
    node_prompt = PromptTextNode("Prompt_Estilo", "Cyberpunk synthwave style, neon lights, 4k resolution")
    node_wan_v2v = Wan2_2V2VNode("Wan2.2_Video2Video_Processor", backend=wan_core)
    node_preview = VideoPreviewNode("Monitor_Preview_Output")

    # 3. INTERCONEXIÓN DEL GRAFO (Resolución de enlaces de cables en la UI)
    node_wan_v2v.connect_input("video_in", node_video, "video_stream")
    node_wan_v2v.connect_input("audio_in", node_audio, "audio_features")
    node_wan_v2v.connect_input("prompt_pos", node_prompt, "text_output")
    
    node_preview.connect_input("video_to_preview", node_wan_v2v, "video_out")

    # 4. MOTOR DE EJECUCIÓN SENSITIVO AL FLUJO (Pipeline Run)
    # Se ejecutan primero los nodos independientes (Nodos Fuente de Inputs)
    node_video.execute()
    node_audio.execute()
    node_prompt.execute()
    
    # Se ejecuta el nodo transformador acoplado al backend DiT
    node_wan_v2v.execute()
    
    # Se despacha el resultado al nodo de salida visual (Preview)
    node_preview.execute()