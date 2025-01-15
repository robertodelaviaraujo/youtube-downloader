const express = require('express');
const { exec } = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const ytpl = require('ytpl');
const cors = require('cors');
const archiver = require('archiver');
const app = express();
const port = process.env.PORT || 5000;

// Configuração básica do CORS
app.use(cors());

// Ou configuração mais restritiva (se necessário)
app.use(cors({
    origin: '*', // Apenas permitir essa origem
    methods: ['GET', 'POST'],
}));

app.use(express.json());

// Função para sanitizar o nome do arquivo
const sanitizeFileName = (name) => {
    return name.replace(/[<>:"/\\|?*]+/g, '').trim();
};

// Função para converter o vídeo para MP3
const convertToMP3 = async (videoName, videoUrl, outputDir) => {
    console.log('convertToMP3...')
    const sanitizedVideoName = sanitizeFileName(videoName); // Sanitizar o nome do vídeo
    const outputPath = path.join(outputDir, `${sanitizedVideoName}.mp3`);

    return new Promise((resolve, reject) => {
        exec(videoUrl, {
            output: outputPath,
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: '128K',
        })
            .then(() => resolve(outputPath))
            .catch((err) => reject(err));
    });
};

// Função para gerar o arquivo ZIP
const createZip = (outputDir, files, zipFilePath) => {
    console.log('createZip...')
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipFilePath);
        const archive = archiver('zip', {
            zlib: { level: 9 } // Nível de compactação
        });

        output.on('close', () => resolve(zipFilePath));
        archive.on('error', (err) => reject(err));

        archive.pipe(output);

        // Adiciona os arquivos MP3 ao ZIP
        files.forEach(file => {
            archive.file(path.join(outputDir, file), { name: file });
        });

        archive.finalize();
    });
};

// Endpoint para converter playlist
app.post('/convert-playlist', async (req, res) => {
    const { playlistUrls, outputDir } = req.body;

    if (!playlistUrls || playlistUrls.length === 0) {
        return res.status(400).send({ error: 'Nenhuma URL de playlist fornecida.' });
    }

    if (!fs.existsSync(outputDir)) {
        return res.status(400).send({ error: 'Diretório não encontrado.' });
    }

    try {
        let allVideos = [];
        for (let playlistUrl of playlistUrls) {
            console.log("🚀 ~ playlistUrl:", playlistUrl)
            const playlist = await ytpl(playlistUrl, { pages: 1 });

            for (let video of playlist.items) {
                const videoUrl = video.shortUrl;
                const videoName = video.title;

                await convertToMP3(videoName, videoUrl, outputDir);
                allVideos.push(`${sanitizeFileName(videoName)}.mp3`);
            }
        }

        // Criar o arquivo ZIP
        const zipFilePath = path.join(outputDir, 'playlist_files.zip');
        console.log("🚀 ~ zipFilePath:", zipFilePath)
        await createZip(outputDir, allVideos, zipFilePath);

        // Enviar o arquivo ZIP para o cliente
        res.download(zipFilePath, 'playlist_files.zip', (err) => {
            if (err) {
                console.error('Erro ao enviar o arquivo:', err);
                res.status(500).send({ error: 'Erro ao enviar o arquivo.' });
            } else {
                // Após o download, exclua o arquivo ZIP temporário
                fs.unlinkSync(zipFilePath);
            }
        });
    } catch (error) {
        console.error('Erro ao processar playlist:', error);
        res.status(500).send({ error: 'Erro ao processar playlist.' });
    }
});

// Iniciar o servidor
app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});
