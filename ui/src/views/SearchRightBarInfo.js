import { boundMethod } from 'autobind-decorator';
import PropTypes from 'prop-types';
import React from 'react';
import { connect } from 'react-redux';
import { compose } from 'recompose';
import createScatterplot from 'regl-scatterplot';

// Components
import Badge from '../components/Badge';
import BarChart from '../components/BarChart';
import Button from '../components/Button';
import ButtonIcon from '../components/ButtonIcon';
import ButtonRadio from '../components/ButtonRadio';
import ElementWrapperAdvanced from '../components/ElementWrapperAdvanced';
import LabeledSlider from '../components/LabeledSlider';
import TabEntry from '../components/TabEntry';

// Actions
import {
  setSearchHover,
  setSearchRightBarMetadata,
  setSearchRightBarProgress,
  setSearchRightBarProjection,
  setSearchRightBarProjectionSettings,
  setSearchSelection
} from '../actions';

// Utils
import { api, debounce, inputToNum, readableDate, zip } from '../utils';

// Configs
import {
  COLOR_BG,
  COLORMAP_CAT,
  COLORMAP_PRB,
  REDRAW_DELAY,
  PROJECTION_CHECK_INTERVAL,
  PROJECTION_VIEW,
  PROJECTION_VIEW_INTERVAL,
  SHOW_RECTICLE,
  RECTICLE_COLOR
} from '../configs/projection';

import {
  BUTTON_RADIO_PROJECTION_COLOR_ENCODING_OPTIONS,
  TAB_RIGHT_BAR_INFO
} from '../configs/search';

// Styles
import './Search.scss';

class SearchRightBarInfo extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      canvas: null,
      colorEncoding: 'categorical',
      isColorByProb: false,
      isDefaultView: true,
      isError: false,
      isInit: false,
      isLoading: false,
      pointSize: 3,
      points: [],
      scatterplot: null,
      selected: [],
      settingsUmapMinDist: 0.1,
      settingsUmapNN: 5,
      umapMinDist: 0.1,
      umapNN: 5
    };

    this.onChangeColorEncoding = compose(this.onChangeState('colorEncoding'));
    this.onChangePointSize = compose(
      this.onChangeState('pointSize'),
      pointSize => {
        if (this.scatterplot) {
          this.scatterplot.set({ pointSize });
        }
        return pointSize;
      },
      inputToNum
    );
    this.onChangeSettingsUmapNN = compose(
      this.onChangeState('settingsUmapNN'),
      inputToNum
    );
    this.onChangeSettingsUmapMinDist = compose(
      this.onChangeState('settingsUmapMinDist'),
      inputToNum
    );

    this.checkViewDb = debounce(
      this.checkView.bind(this),
      PROJECTION_VIEW_INTERVAL
    );
    this.drawScatterplotDb = debounce(
      this.drawScatterplot.bind(this),
      REDRAW_DELAY
    );
  }

  componentDidMount() {
    if (this.props.searchInfo.id) this.loadProjection();
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.isOpen && this.props.searchInfo.id && !this.state.isInit)
      this.loadProjection();
    if (this.isOpen && this.props.tab !== prevProps.tab)
      this.drawScatterplotDb(true);
    if (this.isOpen && this.state.points !== prevState.points)
      this.drawScatterplot(true);
    if (this.state.colorEncoding !== prevState.colorEncoding)
      this.setColorEncoding();
    if (this.props.barWidth && this.props.barWidth !== prevProps.barWidth)
      this.drawScatterplotDb(true);
    if (this.props.selection !== this.selection) this.select();
    if (this.props.hover !== this.hover) this.hover();
  }

  componentWillUnmount() {
    if (this.scatterplot) this.scatterplot.destroy();
  }

  /* ---------------------------- Custom Methods ---------------------------- */

  get isOpen() {
    return this.props.barShow && this.props.tab === TAB_RIGHT_BAR_INFO;
  }

  select() {
    if (!this.scatterplot) return;
    if (this.props.selection.length) {
      this.scatterplot.select(this.props.selection);
    } else {
      this.scatterplot.deselect();
    }
  }

  hover() {
    if (!this.scatterplot) return;
    if (this.props.hover >= 0) {
      this.scatterplot.hover(this.props.hover, true);
    } else {
      this.scatterplot.hover();
    }
  }

  setColorEncoding() {
    if (!this.scatterplot) return;
    if (this.state.colorEncoding === 'probability') {
      this.scatterplot.set({ colorBy: 'value', colors: COLORMAP_PRB });
    } else {
      this.scatterplot.set({ colorBy: 'category', colors: COLORMAP_CAT });
    }
  }

  drawScatterplot(updateSize = false) {
    if (!this.scatterplot) this.initScatterplot();
    else this.updateScatterplot(this.state.points, updateSize);
  }

  initScatterplot(points = this.state.points) {
    if (!points.length || !this.canvasWrapper) return;

    const bBox = this.canvasWrapper.getBoundingClientRect();

    const scatterplot = createScatterplot({
      background: COLOR_BG,
      width: bBox.width,
      height: bBox.height,
      pointSize: this.state.pointSize,
      showRecticle: SHOW_RECTICLE,
      recticleColor: RECTICLE_COLOR,
      view: PROJECTION_VIEW
    });

    scatterplot.subscribe('view', this.checkViewDb);
    scatterplot.subscribe('select', this.onSelect);
    scatterplot.subscribe('deselect', this.onDeselect);

    scatterplot.draw(points);

    this.scatterplot = scatterplot;
    this.setColorEncoding();

    this.setState({ canvas: scatterplot.get('canvas') });
  }

  updateScatterplot(points = this.state.points, updateSize = false) {
    if (!points.length || !this.canvasWrapper) return;
    if (updateSize) {
      const bBox = this.canvasWrapper.getBoundingClientRect();
      this.scatterplot.set({
        width: bBox.width,
        height: bBox.height
      });
      this.scatterplot.refresh();
    }
    this.scatterplot.draw(points);
  }

  prepareProjection(projection, classes, probabilities) {
    return zip([projection, classes, probabilities], [2, 1, 1]);
  }

  @boundMethod
  async newProjection() {
    if (this.state.isLoading) return;

    this.setState({ isLoading: true, isError: false, isNotFound: false });

    const resp = await api.newProjection(
      this.props.searchInfo.id,
      this.state.settingsUmapMinDist,
      this.state.settingsUmapNN
    );
    const isError = resp.status !== 200 ? "Couldn't project data." : false;

    await this.setState({
      umapMinDist: this.state.settingsUmapMinDist,
      umapNN: this.state.settingsUmapNN
    });

    const checkProjectionTimer = isError
      ? null
      : setInterval(this.checkProjection, PROJECTION_CHECK_INTERVAL);

    this.setState({
      isError,
      checkProjectionTimer
    });
  }

  @boundMethod
  async checkProjection() {
    const resp = await api.newProjection(
      this.props.searchInfo.id,
      this.state.umapMinDist,
      this.state.umapNN
    );
    const isError = resp.status !== 200 ? "Couldn't project data." : false;
    const projection = isError ? {} : resp.body;

    if (projection.projectorIsFitting || projection.projectionIsProjecting)
      return;

    clearInterval(this.state.checkProjectionTimer);

    if (isError) this.setState({ isError });
    else this.loadProjection(true);
  }

  async loadProjection(force = false) {
    if (this.state.isLoading && !force) return;

    this.setState({ isLoading: true, isError: false });

    const respClasses = await api.getClasses(this.props.searchInfo.id);
    const respProbs = await api.getProbabilities(this.props.searchInfo.id);
    const respProj = await api.getProjection(this.props.searchInfo.id);

    // Compare the number of windows for which we got classifications, projections, and
    // projections. Those should be the same otherwise the data seems to be corrupted
    const numDiffLenghts = new Set([
      respClasses.body.results.length,
      respProbs.body.results.length,
      respProj.body.projection.length / 2
    ]).size;

    const isNotFound =
      respProj.status === 404 ? 'Projection not computed.' : false;

    let isError =
      !isNotFound && numDiffLenghts > 1 ? 'Data is corrupted!' : false;

    isError =
      !isError &&
      !isNotFound &&
      (respClasses.status !== 200 ||
        respProbs.status !== 200 ||
        respProj.status !== 200)
        ? "Couldn't load projection."
        : isError;

    const classes = isNotFound || isError ? [] : respClasses.body.results;
    const probabilities = isNotFound || isError ? [] : respProbs.body.results;
    const projection = isNotFound || isError ? [] : respProj.body.projection;
    const points = this.prepareProjection(projection, classes, probabilities);
    const umapMinDist =
      isNotFound || isError
        ? this.state.umapMinDist
        : respProj.body.projectorSettings.min_dist;
    const umapNN =
      isNotFound || isError
        ? this.state.umapNN
        : respProj.body.projectorSettings.n_neighbors;

    this.setState({
      isNotFound,
      isError,
      isInit: true,
      isLoading: false,
      points,
      umapMinDist,
      umapNN,
      settingsUmapMinDist: umapMinDist,
      settingsUmapNN: umapNN
    });
  }

  onChangeSettingsNN(key, value) {
    this.setState({ [key]: value });
  }

  onChangeState(key) {
    return value => {
      this.setState({ [key]: value });
    };
  }

  @boundMethod
  onRef(canvasWrapper) {
    this.canvasWrapper = canvasWrapper;
  }

  @boundMethod
  onHover(point) {
    // We need to store a reference to this object to avoid circular events
    this.hoveredPoint = point;
    this.props.setHover(point);
  }

  @boundMethod
  onSelect({ points: selectedPoints = [] } = {}) {
    // We need to store a reference to this object to avoid circular events
    this.selection = selectedPoints;
    this.props.setSelection(selectedPoints);
  }

  @boundMethod
  onDeselect() {
    this.props.setSelection([]);
  }

  checkView(view) {
    const isDefaultView = view.every(
      (x, i) => Math.round(x * 1000000) === PROJECTION_VIEW[i] * 1000000
    );
    this.setState({ isDefaultView });
  }

  @boundMethod
  onResetLocation() {
    this.scatterplot.reset();
  }

  /* -------------------------------- Render -------------------------------- */

  render() {
    return (
      <div className="right-bar-info flex-c flex-v full-wh">
        <TabEntry
          isOpen={this.props.showProjection}
          title="Projection"
          toggle={this.props.toggleProjection}
        >
          <div className="search-right-bar-padding">
            <div className="search-projection-wrapper" ref={this.onRef}>
              {this.isOpen && (
                <ElementWrapperAdvanced
                  className="search-projection"
                  element={this.state.canvas}
                  isError={this.state.isError}
                  isErrorNodes={
                    <Button onClick={this.newProjection}>{'Re-compute'}</Button>
                  }
                  isLoading={this.state.isLoading}
                  isNotFound={this.state.isNotFound}
                />
              )}
              {!this.state.isDefaultView && (
                <ButtonIcon
                  className="search-projection-reset"
                  icon="reset"
                  iconOnly={true}
                  isIconRotationOnFocus={true}
                  isDisabled={this.state.isDefaultView}
                  onClick={this.onResetLocation}
                />
              )}
            </div>
            {this.state.isNotFound && (
              <ul className="no-list-style compact-list right-bar-v-padding">
                <li className="flex-c flex-jc-sb">
                  <Button onClick={this.newProjection}>
                    Compute projection
                  </Button>
                </li>
              </ul>
            )}
            {!!this.state.points.length && (
              <ul className="r no-list-style compact-list right-bar-v-padding">
                <li className="flex-c flex-jc-sb">
                  <ButtonRadio
                    className="full-w"
                    name="search-projection-color-encoding"
                    onClick={this.onChangeColorEncoding}
                    options={BUTTON_RADIO_PROJECTION_COLOR_ENCODING_OPTIONS}
                    selection={this.state.colorEncoding}
                  />
                </li>
                <li>
                  <LabeledSlider
                    disabled={this.state.isLoading || this.state.isError}
                    id="search-projection-settings-point-size"
                    label="Size"
                    max={10}
                    min={0.5}
                    onChange={this.onChangePointSize}
                    sameLine
                    step={0.5}
                    value={this.state.pointSize}
                  />
                </li>
              </ul>
            )}
          </div>
        </TabEntry>
        <TabEntry
          isOpen={this.props.showProjectionSettings}
          title="Projection Settings"
          toggle={this.props.toggleProjectionSettings}
        >
          <div className="search-right-bar-padding">
            <ul className="no-list-style compact-list">
              <li>
                <LabeledSlider
                  id="search-projection-settings-nn"
                  info="https://umap-learn.readthedocs.io/en/latest/parameters.html#n-neighbors"
                  label="Near. Neigh."
                  max={Math.max(Math.sqrt(this.state.points.length), 5)}
                  min={2}
                  onChange={this.onChangeSettingsUmapNN}
                  step={2}
                  value={this.state.settingsUmapNN}
                />
              </li>
              <li>
                <LabeledSlider
                  id="search-projection-settings-min-dist"
                  info="https://umap-learn.readthedocs.io/en/latest/parameters.html#min-dist"
                  label="Min. Dist."
                  max={1}
                  min={0}
                  onChange={this.onChangeSettingsUmapMinDist}
                  step={0.01}
                  value={this.state.settingsUmapMinDist}
                />
              </li>
              <li>
                <Button onClick={this.newProjection}>Update</Button>
              </li>
            </ul>
          </div>
        </TabEntry>
        <TabEntry
          isOpen={this.props.showProgress}
          title="Training Progress"
          toggle={this.props.toggleProgress}
        >
          <ul className="search-right-bar-padding no-list-style compact-list compact-list-with-padding">
            <li className="flex-c flex-v">
              <span className="label">Uncertainty</span>
              <BarChart
                x={this.props.progress.numLabels}
                y={this.props.progress.unpredictabilityAll}
                y2={this.props.progress.unpredictabilityLabels}
                parentWidth={this.props.rightBarWidth}
              />
            </li>
            <li className="flex-c flex-v">
              <span className="label">
                Change in the <abbr title="prediction">pred.</abbr>{' '}
                <abbr title="probability">prob.</abbr>
              </span>
              <BarChart
                x={this.props.progress.numLabels}
                y={this.props.progress.predictionProbaChangeAll}
                y2={this.props.progress.predictionProbaChangeLabels}
                yMax={0.5}
                parentWidth={this.props.rightBarWidth}
              />
            </li>
            <li className="flex-c flex-v">
              <span className="label">Converge (↑) / diverge (↓)</span>
              <BarChart
                x={this.props.progress.numLabels}
                y={this.props.progress.convergenceAll}
                y2={this.props.progress.convergenceLabels}
                y3={this.props.progress.divergenceAll}
                y4={this.props.progress.divergenceLabels}
                diverging
                parentWidth={this.props.rightBarWidth}
              />
            </li>
            <li className="flex-c flex-jc-sb">
              <span className="label flex-g-1"># Labels</span>
              <Badge
                isBordered={true}
                value={this.props.searchInfo.classifications || 0}
              />
            </li>
            <li className="flex-c flex-jc-sb">
              <span className="label flex-g-1"># Trainings</span>
              <Badge
                isBordered={true}
                levelPoor={0}
                levelOkay={1}
                levelGood={3}
                value={this.props.searchInfo.classifiers || 0}
              />
            </li>
          </ul>
        </TabEntry>
        <TabEntry
          isOpen={this.props.showMetadata}
          title="Metadata"
          toggle={this.props.toggleMetadata}
        >
          <div className="search-right-bar-padding">
            <ul className="no-list-style compact-list">
              <li className="flex-c flex-jc-sb">
                <span className="label flex-g-1">Search ID</span>
                <span className="value">{this.props.searchInfo.id || '?'}</span>
              </li>
              <li className="flex-c flex-jc-sb">
                <span className="label flex-g-1">Last Update</span>
                <span className="value">
                  {this.props.searchInfo.updated
                    ? readableDate(this.props.searchInfo.updated)
                    : '?'}
                </span>
              </li>
            </ul>
          </div>
          <div className="flex-c" />
        </TabEntry>
      </div>
    );
  }
}

SearchRightBarInfo.defaultProps = {
  searchInfo: {}
};

SearchRightBarInfo.propTypes = {
  barShow: PropTypes.bool,
  barWidth: PropTypes.number,
  hover: PropTypes.number.isRequired,
  progress: PropTypes.object.isRequired,
  rightBarWidth: PropTypes.number.isRequired,
  searchInfo: PropTypes.object,
  selection: PropTypes.array.isRequired,
  setHover: PropTypes.func.isRequired,
  setSelection: PropTypes.func.isRequired,
  showMetadata: PropTypes.bool.isRequired,
  showProgress: PropTypes.bool.isRequired,
  showProjection: PropTypes.bool.isRequired,
  showProjectionSettings: PropTypes.bool,
  tab: PropTypes.oneOfType([PropTypes.string, PropTypes.symbol]),
  toggleMetadata: PropTypes.func.isRequired,
  toggleProgress: PropTypes.func.isRequired,
  toggleProjection: PropTypes.func.isRequired,
  toggleProjectionSettings: PropTypes.func.isRequired
};

const mapStateToProps = state => ({
  barShow: state.present.searchRightBarShow,
  barWidth: state.present.searchRightBarWidth,
  hover: state.present.searchHover,
  rightBarWidth: state.present.searchRightBarWidth,
  selection: state.present.searchSelection,
  showMetadata: state.present.searchRightBarMetadata,
  showProgress: state.present.searchRightBarProgress,
  showProjection: state.present.searchRightBarProjection,
  showProjectionSettings: state.present.searchRightBarProjectionSettings,
  tab: state.present.searchRightBarTab
});

const mapDispatchToProps = dispatch => ({
  setHover: windowId => dispatch(setSearchHover(windowId)),
  setSelection: windowIds => dispatch(setSearchSelection(windowIds)),
  toggleMetadata: isOpen => dispatch(setSearchRightBarMetadata(!isOpen)),
  toggleProgress: isOpen => dispatch(setSearchRightBarProgress(!isOpen)),
  toggleProjection: isOpen => dispatch(setSearchRightBarProjection(!isOpen)),
  toggleProjectionSettings: isOpen =>
    dispatch(setSearchRightBarProjectionSettings(!isOpen))
});

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(SearchRightBarInfo);
