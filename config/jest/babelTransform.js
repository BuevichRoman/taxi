// Преобразование исходников для jest.
//
// В репозитории нет ни .babelrc, ни ключа babel в package.json: сборка
// настраивает babel прямо в config/webpack.config.js. Из-за этого babel-jest
// запускался без пресетов и не понимал синтаксис TypeScript.
//
// Берём тот же пресет, что и сборка.
'use strict'

const babelJest = require('babel-jest')

module.exports = babelJest.createTransformer({
  presets: [require.resolve('babel-preset-react-app')],
  babelrc: false,
  configFile: false,
})
