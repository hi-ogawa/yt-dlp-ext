project('media-utils', 'cpp')

# Forked from youtube-dl-web-v2/packages/ffmpeg/meson.build
# Only the ex01-emscripten target (libwebm WebM parse/remux).

nlohmann_json_project = subproject('nlohmann_json')
nlohmann_json_dep = nlohmann_json_project.get_variable('nlohmann_json_dep')

libwebm_project = subproject('libwebm')
webm_parser_dep = libwebm_project.get_variable('webm_parser_dep')
mkvmuxer_dep = libwebm_project.get_variable('mkvmuxer_dep')

emscripten_link_args = [
  '--bind',
  '-s', 'ALLOW_MEMORY_GROWTH=1',
  '-s', 'MODULARIZE=1',
  '-s', 'DYNAMIC_EXECUTION=0',
  '--minify', '0',
]

executable(
  'ex01-emscripten',
  meson.current_source_dir() / 'src/ex01-emscripten.cpp',
  name_suffix: 'js',
  dependencies: [
    nlohmann_json_dep,
    webm_parser_dep,
    mkvmuxer_dep,
  ],
  link_args: emscripten_link_args,
)
