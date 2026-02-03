# Imagem oficial do Node (estável)
FROM node:18-alpine

# Diretório de trabalho dentro do container
WORKDIR /app

# Copia package.json primeiro (cache)
COPY package.json ./

# Instala dependências
RUN npm install

# Copia o restante do código
COPY . .

# Expõe a porta usada pela aplicação
EXPOSE 3000

# Comando para iniciar o app
CMD ["npm", "start"]
