import { type FormEvent, useEffect, useState } from 'react';
import { type SpringPage } from '../../services/cafeteriaAdmin';
import {
  type CategoryAdminItem,
  type CategoryFieldErrors,
  type ProductAdminItem,
  type ProductFieldErrors,
  createAdminCategory,
  createAdminProduct,
  createCatalogIdempotencyKey,
  deactivateAdminCategory,
  deactivateAdminProduct,
  extractCatalogFieldErrors,
  formatCatalogAdminError,
  isValidHttpsImageUrl,
  listAdminCategories,
  listAdminProducts,
  reactivateAdminCategory,
  reactivateAdminProduct,
  updateAdminCategory,
  updateAdminProduct,
  validateCategoryForm,
  validateProductForm,
  validateProductSearchQuery,
} from '../../services/catalogAdmin';
import { ApiRequestError } from '../../services/httpClient';
import { ProductImage } from '../ProductImage';
import { ProductImageManager } from '../ProductImageManager';
import { ErrorState } from '../common/ErrorState';
import { LoadingSpinner } from '../common/LoadingSpinner';

type CatalogTab = 'productos' | 'categorias' | 'imagenes';

type ProductsLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      pageData: SpringPage<ProductAdminItem>;
      categories: CategoryAdminItem[];
    };

type CategoriesLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; pageData: SpringPage<CategoryAdminItem> };

const CATEGORY_FIELDS = ['nombre', 'descripcion'] as const;
const PRODUCT_FIELDS = ['categoriaId', 'nombre', 'descripcion', 'imagenUrl'] as const;

interface SuperAdminCatalogSectionProps {
  userId?: string | null;
}

export function SuperAdminCatalogSection({ userId }: SuperAdminCatalogSectionProps) {
  const [activeTab, setActiveTab] = useState<CatalogTab>('productos');

  // Filtros de productos (compartidos para poder saltar desde categoría en uso)
  const [productCategoryFilter, setProductCategoryFilter] = useState<string>('');
  const [productActivoFilter, setProductActivoFilter] = useState<'all' | 'true' | 'false'>('all');
  const [productSearchDraft, setProductSearchDraft] = useState<string>('');
  const [productSearchQuery, setProductSearchQuery] = useState<string>('');
  const [productSearchError, setProductSearchError] = useState<string>('');
  const [productPage, setProductPage] = useState<number>(0);
  const [productsReloadTick, setProductsReloadTick] = useState<number>(0);
  const [productsState, setProductsState] = useState<ProductsLoadState>({ status: 'loading' });

  // Estado formularios de productos
  const [createProdCategoryId, setCreateProdCategoryId] = useState<string>('');
  const [createProdNombre, setCreateProdNombre] = useState<string>('');
  const [createProdDescripcion, setCreateProdDescripcion] = useState<string>('');
  const [createProdImagenUrl, setCreateProdImagenUrl] = useState<string>('');
  const [createProdFieldErrors, setCreateProdFieldErrors] = useState<ProductFieldErrors>({});
  const [createProdIdempotencyKey, setCreateProdIdempotencyKey] = useState<string>(() =>
    createCatalogIdempotencyKey(),
  );

  const [editingProduct, setEditingProduct] = useState<ProductAdminItem | null>(null);
  const [editProdCategoryId, setEditProdCategoryId] = useState<string>('');
  const [editProdNombre, setEditProdNombre] = useState<string>('');
  const [editProdDescripcion, setEditProdDescripcion] = useState<string>('');
  const [editProdImagenUrl, setEditProdImagenUrl] = useState<string>('');
  const [editProdFieldErrors, setEditProdFieldErrors] = useState<ProductFieldErrors>({});

  const [confirmingProductDeactivation, setConfirmingProductDeactivation] =
    useState<ProductAdminItem | null>(null);

  // Filtros y estado de categorías
  const [categoryActivoFilter, setCategoryActivoFilter] = useState<'all' | 'true' | 'false'>('all');
  const [categorySearchQuery, setCategorySearchQuery] = useState<string>('');
  const [categoryPage, setCategoryPage] = useState<number>(0);
  const [categoriesReloadTick, setCategoriesReloadTick] = useState<number>(0);
  const [categoriesState, setCategoriesState] = useState<CategoriesLoadState>({ status: 'loading' });

  // Estado formularios de categorías
  const [createCatNombre, setCreateCatNombre] = useState<string>('');
  const [createCatDescripcion, setCreateCatDescripcion] = useState<string>('');
  const [createCatFieldErrors, setCreateCatFieldErrors] = useState<CategoryFieldErrors>({});
  const [createCatIdempotencyKey, setCreateCatIdempotencyKey] = useState<string>(() =>
    createCatalogIdempotencyKey(),
  );

  const [editingCategory, setEditingCategory] = useState<CategoryAdminItem | null>(null);
  const [editCatNombre, setEditCatNombre] = useState<string>('');
  const [editCatDescripcion, setEditCatDescripcion] = useState<string>('');
  const [editCatFieldErrors, setEditCatFieldErrors] = useState<CategoryFieldErrors>({});

  const [confirmingCategoryDeactivation, setConfirmingCategoryDeactivation] =
    useState<CategoryAdminItem | null>(null);
  const [categoryInUseConflict, setCategoryInUseConflict] = useState<CategoryAdminItem | null>(null);

  // Mensajes globales y bloqueo de envíos
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [formError, setFormError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Carga de productos y categorías de referencia
  useEffect(() => {
    if (activeTab !== 'productos') return;

    const controller = new AbortController();
    setProductsState((prev) =>
      prev.status === 'success' && productsReloadTick > 0 ? prev : { status: 'loading' },
    );

    const parsedActivo =
      productActivoFilter === 'all' ? undefined : productActivoFilter === 'true';

    Promise.all([
      listAdminCategories({ page: 0, size: 100 }, controller.signal),
      listAdminProducts(
        {
          categoriaId: productCategoryFilter || undefined,
          q: productSearchQuery || undefined,
          activo: parsedActivo,
          page: productPage,
          size: 20,
        },
        controller.signal,
      ),
    ])
      .then(([categoriesPage, productsPage]) => {
        if (controller.signal.aborted) return;
        const categories = categoriesPage.content ?? [];
        setProductsState({
          status: 'success',
          pageData: productsPage,
          categories,
        });
        setCreateProdCategoryId((current) => {
          if (current && categories.some((c) => c.categoriaId === current && c.activa)) {
            return current;
          }
          return categories.find((c) => c.activa)?.categoriaId ?? '';
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProductsState({
          status: 'error',
          message: formatCatalogAdminError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    activeTab,
    productCategoryFilter,
    productActivoFilter,
    productSearchQuery,
    productPage,
    productsReloadTick,
  ]);

  // Carga de categorías paginadas
  useEffect(() => {
    if (activeTab !== 'categorias') return;

    const controller = new AbortController();
    setCategoriesState((prev) =>
      prev.status === 'success' && categoriesReloadTick > 0 ? prev : { status: 'loading' },
    );

    const parsedActivo =
      categoryActivoFilter === 'all' ? undefined : categoryActivoFilter === 'true';

    listAdminCategories(
      {
        activo: parsedActivo,
        page: categoryPage,
        size: 20,
      },
      controller.signal,
    )
      .then((pageData) => {
        if (controller.signal.aborted) return;
        setCategoriesState({ status: 'success', pageData });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setCategoriesState({
          status: 'error',
          message: formatCatalogAdminError(error),
        });
      });

    return () => {
      controller.abort();
    };
  }, [activeTab, categoryActivoFilter, categoryPage, categoriesReloadTick]);

  function switchTab(nextTab: CatalogTab) {
    setActiveTab(nextTab);
    setFormError('');
    setFeedbackMessage('');
    setCategoryInUseConflict(null);
  }

  function refreshProducts() {
    setProductsReloadTick((tick) => tick + 1);
  }

  function refreshCategories() {
    setCategoriesReloadTick((tick) => tick + 1);
  }

  function openActiveProductsForCategory(category: CategoryAdminItem) {
    setCategoryInUseConflict(null);
    setConfirmingCategoryDeactivation(null);
    setFormError('');
    setFeedbackMessage(
      `Mostrando productos activos de la categoría "${category.nombre}" para darlos de baja o reasignarlos.`,
    );
    setProductCategoryFilter(category.categoriaId);
    setProductActivoFilter('true');
    setProductSearchDraft('');
    setProductSearchQuery('');
    setProductSearchError('');
    setProductPage(0);
    setActiveTab('productos');
    setProductsReloadTick((tick) => tick + 1);
  }

  // --- Handlers de Productos ---

  function handleProductSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateProductSearchQuery(productSearchDraft);
    if (validationError) {
      setProductSearchError(validationError);
      return;
    }
    setProductSearchError('');
    setProductPage(0);
    setProductSearchQuery(productSearchDraft.trim());
  }

  function clearProductFilters() {
    setProductCategoryFilter('');
    setProductActivoFilter('all');
    setProductSearchDraft('');
    setProductSearchQuery('');
    setProductSearchError('');
    setProductPage(0);
  }

  async function handleCreateProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');

    const fieldErrors = validateProductForm({
      categoriaId: createProdCategoryId,
      nombre: createProdNombre,
      descripcion: createProdDescripcion,
      imagenUrl: createProdImagenUrl,
    });
    setCreateProdFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createAdminProduct(
        {
          categoriaId: createProdCategoryId,
          nombre: createProdNombre,
          descripcion: createProdDescripcion || undefined,
          imagenUrl: createProdImagenUrl || undefined,
        },
        createProdIdempotencyKey,
      );
      setCreateProdNombre('');
      setCreateProdDescripcion('');
      setCreateProdImagenUrl('');
      setCreateProdFieldErrors({});
      setCreateProdIdempotencyKey(createCatalogIdempotencyKey());
      setFeedbackMessage(`Producto "${created.nombre}" creado correctamente.`);
      refreshProducts();
    } catch (error: unknown) {
      if (
        !(error instanceof ApiRequestError) ||
        (error.status !== null && error.status !== 503 && error.code !== 'OPERACION_PENDIENTE')
      ) {
        setCreateProdIdempotencyKey(createCatalogIdempotencyKey());
      }
      setCreateProdFieldErrors(extractCatalogFieldErrors(error, PRODUCT_FIELDS));
      setFormError(formatCatalogAdminError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditProduct(product: ProductAdminItem) {
    setEditingProduct(product);
    setEditProdCategoryId(product.categoriaId);
    setEditProdNombre(product.nombre);
    setEditProdDescripcion(product.descripcion ?? '');
    setEditProdImagenUrl(product.imagenUrl ?? '');
    setEditProdFieldErrors({});
    setConfirmingProductDeactivation(null);
    setFormError('');
    setFeedbackMessage('');
  }

  async function handleEditProductSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct || isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');

    const fieldErrors = validateProductForm({
      categoriaId: editProdCategoryId,
      nombre: editProdNombre,
      descripcion: editProdDescripcion,
      imagenUrl: editProdImagenUrl,
    });
    setEditProdFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateAdminProduct(editingProduct.productoId, {
        categoriaId:
          editProdCategoryId !== editingProduct.categoriaId ? editProdCategoryId : undefined,
        nombre: editProdNombre,
        descripcion: editProdDescripcion || undefined,
        imagenUrl: editProdImagenUrl || undefined,
        version: editingProduct.version,
      });
      setEditingProduct(null);
      setEditProdFieldErrors({});
      setFeedbackMessage(`Producto "${updated.nombre}" actualizado a la versión ${updated.version}.`);
      refreshProducts();
    } catch (error: unknown) {
      setEditProdFieldErrors(extractCatalogFieldErrors(error, PRODUCT_FIELDS));
      setFormError(formatCatalogAdminError(error));
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICTO') {
        setEditingProduct(null);
        refreshProducts();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDeactivateProduct() {
    if (!confirmingProductDeactivation || isSubmitting) return;

    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    try {
      const updated = await deactivateAdminProduct(confirmingProductDeactivation.productoId);
      setConfirmingProductDeactivation(null);
      setFeedbackMessage(
        `El producto "${updated.nombre}" fue dado de baja lógica. Dejó de estar disponible en la venta pública sin borrar su historial.`,
      );
      refreshProducts();
    } catch (error: unknown) {
      setFormError(formatCatalogAdminError(error));
      refreshProducts();
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReactivateProduct(product: ProductAdminItem) {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    try {
      const updated = await reactivateAdminProduct(product.productoId);
      setFeedbackMessage(`El producto "${updated.nombre}" fue reactivado correctamente.`);
      refreshProducts();
    } catch (error: unknown) {
      setFormError(formatCatalogAdminError(error));
      refreshProducts();
    } finally {
      setIsSubmitting(false);
    }
  }

  // --- Handlers de Categorías ---

  async function handleCreateCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');
    setCategoryInUseConflict(null);

    const fieldErrors = validateCategoryForm({
      nombre: createCatNombre,
      descripcion: createCatDescripcion,
    });
    setCreateCatFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await createAdminCategory(
        {
          nombre: createCatNombre,
          descripcion: createCatDescripcion || undefined,
        },
        createCatIdempotencyKey,
      );
      setCreateCatNombre('');
      setCreateCatDescripcion('');
      setCreateCatFieldErrors({});
      setCreateCatIdempotencyKey(createCatalogIdempotencyKey());
      setFeedbackMessage(`Categoría "${created.nombre}" creada correctamente.`);
      refreshCategories();
    } catch (error: unknown) {
      if (
        !(error instanceof ApiRequestError) ||
        (error.status !== null && error.status !== 503 && error.code !== 'OPERACION_PENDIENTE')
      ) {
        setCreateCatIdempotencyKey(createCatalogIdempotencyKey());
      }
      setCreateCatFieldErrors(extractCatalogFieldErrors(error, CATEGORY_FIELDS));
      setFormError(formatCatalogAdminError(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  function startEditCategory(category: CategoryAdminItem) {
    setEditingCategory(category);
    setEditCatNombre(category.nombre);
    setEditCatDescripcion(category.descripcion ?? '');
    setEditCatFieldErrors({});
    setConfirmingCategoryDeactivation(null);
    setCategoryInUseConflict(null);
    setFormError('');
    setFeedbackMessage('');
  }

  async function handleEditCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCategory || isSubmitting) return;

    setFormError('');
    setFeedbackMessage('');
    setCategoryInUseConflict(null);

    const fieldErrors = validateCategoryForm({
      nombre: editCatNombre,
      descripcion: editCatDescripcion,
    });
    setEditCatFieldErrors(fieldErrors);
    if (Object.keys(fieldErrors).length > 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateAdminCategory(editingCategory.categoriaId, {
        nombre: editCatNombre,
        descripcion: editCatDescripcion || undefined,
        version: editingCategory.version,
      });
      setEditingCategory(null);
      setEditCatFieldErrors({});
      setFeedbackMessage(
        `Categoría "${updated.nombre}" actualizada a la versión ${updated.version}.`,
      );
      refreshCategories();
    } catch (error: unknown) {
      setEditCatFieldErrors(extractCatalogFieldErrors(error, CATEGORY_FIELDS));
      setFormError(formatCatalogAdminError(error));
      if (error instanceof ApiRequestError && error.code === 'VERSION_CONFLICTO') {
        setEditingCategory(null);
        refreshCategories();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirmDeactivateCategory() {
    if (!confirmingCategoryDeactivation || isSubmitting) return;

    const targetCategory = confirmingCategoryDeactivation;
    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    setCategoryInUseConflict(null);
    try {
      const updated = await deactivateAdminCategory(targetCategory.categoriaId);
      setConfirmingCategoryDeactivation(null);
      setFeedbackMessage(
        `La categoría "${updated.nombre}" fue dada de baja lógica. Ya no aparece en el catálogo público y conserva sus productos inactivos e historial.`,
      );
      refreshCategories();
    } catch (error: unknown) {
      setFormError(formatCatalogAdminError(error));
      if (error instanceof ApiRequestError && error.code === 'CATEGORIA_EN_USO') {
        setCategoryInUseConflict(targetCategory);
        setConfirmingCategoryDeactivation(null);
      } else {
        refreshCategories();
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleReactivateCategory(category: CategoryAdminItem) {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setFormError('');
    setFeedbackMessage('');
    setCategoryInUseConflict(null);
    try {
      const updated = await reactivateAdminCategory(category.categoriaId);
      setFeedbackMessage(`La categoría "${updated.nombre}" fue reactivada correctamente.`);
      refreshCategories();
    } catch (error: unknown) {
      setFormError(formatCatalogAdminError(error));
      refreshCategories();
    } finally {
      setIsSubmitting(false);
    }
  }

  // --- Render ---

  return (
    <div className="admin-catalog-section">
      <div className="admin-subtabs" role="tablist" aria-label="Gestión del catálogo maestro">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'productos'}
          className={`admin-subtab${activeTab === 'productos' ? ' active' : ''}`}
          onClick={() => switchTab('productos')}
        >
          Productos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'categorias'}
          className={`admin-subtab${activeTab === 'categorias' ? ' active' : ''}`}
          onClick={() => switchTab('categorias')}
        >
          Categorías
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'imagenes'}
          className={`admin-subtab${activeTab === 'imagenes' ? ' active' : ''}`}
          onClick={() => switchTab('imagenes')}
        >
          Imágenes de productos
        </button>
      </div>

      {feedbackMessage && (
        <p role="status" className="admin-feedback-success">
          {feedbackMessage}
        </p>
      )}
      {formError && (
        <div role="alert" className="admin-feedback-error">
          <p style={{ margin: 0 }}>{formError}</p>
          {categoryInUseConflict && (
            <div className="admin-form-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn-primary"
                onClick={() => openActiveProductsForCategory(categoryInUseConflict)}
              >
                Ver productos activos de "{categoryInUseConflict.nombre}"
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'imagenes' && (
        <section className="admin-panel-notice">
          <ProductImageManager key={userId ?? 'catalog-images'} />
        </section>
      )}

      {activeTab === 'productos' && (
        <div className="admin-catalog-tab-panel" role="tabpanel" aria-label="Productos del catálogo maestro">
          {productsState.status === 'loading' && (
            <div role="status" className="admin-panel-notice">
              <LoadingSpinner />
              <p>Cargando productos y categorías del catálogo maestro…</p>
            </div>
          )}

          {productsState.status === 'error' && (
            <div role="alert" className="admin-panel-notice">
              <ErrorState message={productsState.message} />
              <button type="button" className="btn-primary" onClick={refreshProducts}>
                Reintentar carga
              </button>
            </div>
          )}

          {productsState.status === 'success' && (() => {
            const { pageData, categories } = productsState;
            const categoryById = new Map(categories.map((cat) => [cat.categoriaId, cat]));
            const activeCategories = categories.filter((cat) => cat.activa);
            const hasProductFilters = Boolean(
              productCategoryFilter || productSearchQuery || productActivoFilter !== 'all',
            );

            return (
              <>
                <section className="admin-panel-notice" aria-labelledby="create-product-heading">
                  <h2 id="create-product-heading">Crear nuevo producto</h2>
                  <p>
                    Los productos del catálogo maestro quedan disponibles para que las cafeterías
                    publiquen ofertas. La baja lógica los oculta de la venta pública sin borrar historial.
                  </p>
                  {activeCategories.length === 0 && (
                    <p role="status" className="admin-inactive-effect">
                      No hay categorías activas disponibles. Crea o reactiva una categoría en la
                      pestaña Categorías antes de registrar un producto.
                    </p>
                  )}
                  <form
                    className="admin-form-grid"
                    onSubmit={(event) => void handleCreateProductSubmit(event)}
                    noValidate
                  >
                    <div className="admin-form-field">
                      <label>
                        Categoría del producto
                        <select
                          value={createProdCategoryId}
                          disabled={isSubmitting || activeCategories.length === 0}
                          aria-invalid={Boolean(createProdFieldErrors.categoriaId)}
                          aria-describedby={
                            createProdFieldErrors.categoriaId ? 'create-prod-cat-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateProdCategoryId(event.target.value);
                            setCreateProdFieldErrors((prev) => ({ ...prev, categoriaId: undefined }));
                          }}
                        >
                          <option value="">Selecciona una categoría activa</option>
                          {activeCategories.map((cat) => (
                            <option key={cat.categoriaId} value={cat.categoriaId}>
                              {cat.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      {createProdFieldErrors.categoriaId && (
                        <span id="create-prod-cat-error" role="alert" className="admin-field-error">
                          {createProdFieldErrors.categoriaId}
                        </span>
                      )}
                    </div>

                    <div className="admin-form-field">
                      <label>
                        Nombre del producto
                        <input
                          type="text"
                          maxLength={150}
                          placeholder="Ej. Cappuccino Vainilla"
                          value={createProdNombre}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(createProdFieldErrors.nombre)}
                          aria-describedby={
                            createProdFieldErrors.nombre ? 'create-prod-name-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateProdNombre(event.target.value);
                            setCreateProdFieldErrors((prev) => ({ ...prev, nombre: undefined }));
                          }}
                        />
                      </label>
                      {createProdFieldErrors.nombre && (
                        <span id="create-prod-name-error" role="alert" className="admin-field-error">
                          {createProdFieldErrors.nombre}
                        </span>
                      )}
                    </div>

                    <div className="admin-form-field">
                      <label>
                        URL de imagen (HTTPS, opcional)
                        <input
                          type="url"
                          maxLength={255}
                          placeholder="https://cdn.cloudcoffee.cl/productos/cappuccino.jpg"
                          value={createProdImagenUrl}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(createProdFieldErrors.imagenUrl)}
                          aria-describedby={
                            createProdFieldErrors.imagenUrl ? 'create-prod-img-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateProdImagenUrl(event.target.value);
                            setCreateProdFieldErrors((prev) => ({ ...prev, imagenUrl: undefined }));
                          }}
                        />
                      </label>
                      {createProdFieldErrors.imagenUrl && (
                        <span id="create-prod-img-error" role="alert" className="admin-field-error">
                          {createProdFieldErrors.imagenUrl}
                        </span>
                      )}
                    </div>

                    <div className="admin-form-field admin-form-field-wide">
                      <label>
                        Descripción del producto (opcional)
                        <textarea
                          rows={2}
                          maxLength={1000}
                          placeholder="Describe ingredientes o presentación del producto"
                          value={createProdDescripcion}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(createProdFieldErrors.descripcion)}
                          aria-describedby={
                            createProdFieldErrors.descripcion ? 'create-prod-desc-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateProdDescripcion(event.target.value);
                            setCreateProdFieldErrors((prev) => ({ ...prev, descripcion: undefined }));
                          }}
                        />
                      </label>
                      {createProdFieldErrors.descripcion && (
                        <span id="create-prod-desc-error" role="alert" className="admin-field-error">
                          {createProdFieldErrors.descripcion}
                        </span>
                      )}
                    </div>

                    {createProdImagenUrl.trim() && isValidHttpsImageUrl(createProdImagenUrl) && (
                      <div className="admin-image-preview-box">
                        <ProductImage
                          src={createProdImagenUrl.trim()}
                          name={createProdNombre.trim() || 'Vista previa de imagen del producto'}
                          className="admin-catalog-thumb"
                        />
                      </div>
                    )}

                    <div className="admin-form-actions">
                      <button type="submit" className="btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? 'Guardando…' : 'Crear producto'}
                      </button>
                    </div>
                  </form>
                </section>

                {editingProduct && (
                  <section className="admin-panel-notice" aria-labelledby="edit-product-heading">
                    <h2 id="edit-product-heading">Editar producto: {editingProduct.nombre}</h2>
                    <form
                      className="admin-form-grid"
                      onSubmit={(event) => void handleEditProductSubmit(event)}
                      noValidate
                    >
                      <div className="admin-form-field">
                        <label>
                          Categoría al editar producto
                          <select
                            value={editProdCategoryId}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editProdFieldErrors.categoriaId)}
                            aria-describedby={
                              editProdFieldErrors.categoriaId ? 'edit-prod-cat-error' : undefined
                            }
                            onChange={(event) => {
                              setEditProdCategoryId(event.target.value);
                              setEditProdFieldErrors((prev) => ({ ...prev, categoriaId: undefined }));
                            }}
                          >
                            <option value="">Selecciona una categoría activa</option>
                            {categories.map((cat) => (
                              <option
                                key={cat.categoriaId}
                                value={cat.categoriaId}
                                disabled={!cat.activa && cat.categoriaId !== editingProduct.categoriaId}
                              >
                                {cat.nombre}
                                {!cat.activa ? ' (Inactiva)' : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        {editProdFieldErrors.categoriaId && (
                          <span id="edit-prod-cat-error" role="alert" className="admin-field-error">
                            {editProdFieldErrors.categoriaId}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-field">
                        <label>
                          Nombre al editar producto
                          <input
                            type="text"
                            maxLength={150}
                            value={editProdNombre}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editProdFieldErrors.nombre)}
                            aria-describedby={
                              editProdFieldErrors.nombre ? 'edit-prod-name-error' : undefined
                            }
                            onChange={(event) => {
                              setEditProdNombre(event.target.value);
                              setEditProdFieldErrors((prev) => ({ ...prev, nombre: undefined }));
                            }}
                          />
                        </label>
                        {editProdFieldErrors.nombre && (
                          <span id="edit-prod-name-error" role="alert" className="admin-field-error">
                            {editProdFieldErrors.nombre}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-field">
                        <label>
                          URL de imagen al editar producto
                          <input
                            type="url"
                            maxLength={255}
                            value={editProdImagenUrl}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editProdFieldErrors.imagenUrl)}
                            aria-describedby={
                              editProdFieldErrors.imagenUrl ? 'edit-prod-img-error' : undefined
                            }
                            onChange={(event) => {
                              setEditProdImagenUrl(event.target.value);
                              setEditProdFieldErrors((prev) => ({ ...prev, imagenUrl: undefined }));
                            }}
                          />
                        </label>
                        {editProdFieldErrors.imagenUrl && (
                          <span id="edit-prod-img-error" role="alert" className="admin-field-error">
                            {editProdFieldErrors.imagenUrl}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-field admin-form-field-wide">
                        <label>
                          Descripción al editar producto
                          <textarea
                            rows={2}
                            maxLength={1000}
                            value={editProdDescripcion}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editProdFieldErrors.descripcion)}
                            aria-describedby={
                              editProdFieldErrors.descripcion ? 'edit-prod-desc-error' : undefined
                            }
                            onChange={(event) => {
                              setEditProdDescripcion(event.target.value);
                              setEditProdFieldErrors((prev) => ({ ...prev, descripcion: undefined }));
                            }}
                          />
                        </label>
                        {editProdFieldErrors.descripcion && (
                          <span id="edit-prod-desc-error" role="alert" className="admin-field-error">
                            {editProdFieldErrors.descripcion}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-actions">
                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                          {isSubmitting ? 'Actualizando…' : 'Guardar cambios del producto'}
                        </button>
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          disabled={isSubmitting}
                          onClick={() => setEditingProduct(null)}
                        >
                          Cancelar edición
                        </button>
                      </div>
                    </form>
                  </section>
                )}

                {confirmingProductDeactivation && (
                  <section
                    className="admin-panel-notice admin-confirm-box"
                    role="alertdialog"
                    aria-labelledby="confirm-deactivate-product-heading"
                  >
                    <h2 id="confirm-deactivate-product-heading">Confirmar baja lógica de producto</h2>
                    <p>
                      ¿Confirmas dar de baja el producto{' '}
                      <strong>{confirmingProductDeactivation.nombre}</strong>? Dejará de mostrarse en el
                      catálogo público y no admitirá nuevas compras, pero se conservarán sus ofertas e
                      historial de pedidos.
                    </p>
                    <div className="admin-form-actions">
                      <button
                        type="button"
                        className="admin-btn-danger"
                        disabled={isSubmitting}
                        onClick={() => void handleConfirmDeactivateProduct()}
                      >
                        {isSubmitting ? 'Procesando…' : 'Confirmar baja de producto'}
                      </button>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={isSubmitting}
                        onClick={() => setConfirmingProductDeactivation(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </section>
                )}

                <section className="admin-panel-notice" aria-labelledby="products-list-heading">
                  <div className="admin-list-header">
                    <div>
                      <h2 id="products-list-heading">Productos del catálogo maestro</h2>
                      <p>
                        Total encontrados: <strong>{pageData.totalElements}</strong>
                      </p>
                    </div>

                    <div className="admin-filters-bar">
                      <form
                        className="admin-search-inline"
                        onSubmit={handleProductSearchSubmit}
                        noValidate
                      >
                        <label>
                          Buscar producto
                          <input
                            type="search"
                            placeholder="Nombre o descripción (mín. 2 letras)"
                            value={productSearchDraft}
                            aria-invalid={Boolean(productSearchError)}
                            onChange={(event) => {
                              setProductSearchDraft(event.target.value);
                              if (productSearchError) setProductSearchError('');
                            }}
                          />
                        </label>
                        <button type="submit" className="admin-btn-secondary">
                          Buscar
                        </button>
                      </form>

                      <label>
                        Filtrar por categoría
                        <select
                          value={productCategoryFilter}
                          onChange={(event) => {
                            setProductCategoryFilter(event.target.value);
                            setProductPage(0);
                          }}
                        >
                          <option value="">Todas las categorías</option>
                          {categories.map((cat) => (
                            <option key={cat.categoriaId} value={cat.categoriaId}>
                              {cat.nombre}
                              {!cat.activa ? ' (Inactiva)' : ''}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label>
                        Estado de producto
                        <select
                          value={productActivoFilter}
                          onChange={(event) => {
                            setProductActivoFilter(event.target.value as 'all' | 'true' | 'false');
                            setProductPage(0);
                          }}
                        >
                          <option value="all">Todos (activos e inactivos)</option>
                          <option value="true">Solo activos</option>
                          <option value="false">Solo inactivos</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {productSearchError && (
                    <p role="alert" className="admin-field-error" style={{ marginBottom: '0.75rem' }}>
                      {productSearchError}
                    </p>
                  )}

                  {pageData.content.length === 0 ? (
                    <div className="admin-empty-box" role="status">
                      <p>
                        {hasProductFilters
                          ? 'No se encontraron productos para los filtros aplicados.'
                          : 'Aún no hay productos registrados en el catálogo maestro.'}
                      </p>
                      {hasProductFilters && (
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          onClick={clearProductFilters}
                        >
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="admin-cafeterias-list">
                      {pageData.content.map((product) => {
                        const category = categoryById.get(product.categoriaId);
                        return (
                          <li
                            key={product.productoId}
                            className={`admin-cafeteria-row${!product.activo ? ' admin-row-inactive' : ''}`}
                          >
                            <div className="admin-catalog-item-main">
                              {product.imagenUrl && (
                                <ProductImage
                                  productId={product.productoId}
                                  src={product.imagenUrl}
                                  name={product.nombre}
                                  className="admin-catalog-thumb"
                                />
                              )}
                              <div>
                                <div className="admin-catalog-item-title">
                                  <strong>{product.nombre}</strong>
                                  <span
                                    className={`admin-status-pill ${
                                      product.activo ? 'admin-status-active' : 'admin-status-inactive'
                                    }`}
                                  >
                                    {product.activo ? 'Activo' : 'Inactivo'}
                                  </span>
                                  <span className="admin-version-tag">v{product.version}</span>
                                </div>
                                <p className="admin-catalog-meta">
                                  Categoría:{' '}
                                  <strong>
                                    {category ? category.nombre : product.categoriaId}
                                  </strong>
                                  {category && !category.activa && (
                                    <span className="admin-status-pill admin-status-inactive">
                                      Categoría inactiva
                                    </span>
                                  )}
                                </p>
                                {product.descripcion && (
                                  <p className="admin-catalog-description">{product.descripcion}</p>
                                )}
                                {!product.activo && (
                                  <p className="admin-inactive-effect">
                                    Oculto en la venta pública; conserva ofertas previas e historial de
                                    compras.
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="admin-form-actions">
                              <button
                                type="button"
                                className="admin-btn-secondary"
                                disabled={isSubmitting}
                                onClick={() => startEditProduct(product)}
                              >
                                Editar
                              </button>
                              {product.activo ? (
                                <button
                                  type="button"
                                  className="admin-btn-danger"
                                  disabled={isSubmitting}
                                  onClick={() => {
                                    setConfirmingProductDeactivation(product);
                                    setEditingProduct(null);
                                    setFormError('');
                                    setFeedbackMessage('');
                                  }}
                                >
                                  Dar de baja
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn-primary"
                                  disabled={isSubmitting}
                                  onClick={() => void handleReactivateProduct(product)}
                                >
                                  Reactivar
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {pageData.totalPages > 1 && (
                    <nav className="admin-pagination" aria-label="Paginación de productos">
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={pageData.first}
                        onClick={() => setProductPage((current) => Math.max(0, current - 1))}
                      >
                        Anterior
                      </button>
                      <span>
                        Página {pageData.number + 1} de {pageData.totalPages}
                      </span>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={pageData.last}
                        onClick={() => setProductPage((current) => current + 1)}
                      >
                        Siguiente
                      </button>
                    </nav>
                  )}
                </section>
              </>
            );
          })()}
        </div>
      )}

      {activeTab === 'categorias' && (
        <div className="admin-catalog-tab-panel" role="tabpanel" aria-label="Categorías del catálogo maestro">
          {categoriesState.status === 'loading' && (
            <div role="status" className="admin-panel-notice">
              <LoadingSpinner />
              <p>Cargando categorías del catálogo maestro…</p>
            </div>
          )}

          {categoriesState.status === 'error' && (
            <div role="alert" className="admin-panel-notice">
              <ErrorState message={categoriesState.message} />
              <button type="button" className="btn-primary" onClick={refreshCategories}>
                Reintentar carga
              </button>
            </div>
          )}

          {categoriesState.status === 'success' && (() => {
            const { pageData } = categoriesState;
            const normalizedSearch = categorySearchQuery.trim().toLowerCase();
            const visibleCategories = normalizedSearch
              ? pageData.content.filter(
                  (cat) =>
                    cat.nombre.toLowerCase().includes(normalizedSearch) ||
                    (cat.descripcion ?? '').toLowerCase().includes(normalizedSearch),
                )
              : pageData.content;
            const hasCategoryFilters = Boolean(normalizedSearch || categoryActivoFilter !== 'all');

            return (
              <>
                <section className="admin-panel-notice" aria-labelledby="create-category-heading">
                  <h2 id="create-category-heading">Crear nueva categoría</h2>
                  <p>
                    Las categorías agrupan el catálogo maestro. Solo puedes dar de baja una categoría
                    cuando no tenga productos activos asociados.
                  </p>
                  <form
                    className="admin-form-grid"
                    onSubmit={(event) => void handleCreateCategorySubmit(event)}
                    noValidate
                  >
                    <div className="admin-form-field">
                      <label>
                        Nombre de la categoría
                        <input
                          type="text"
                          maxLength={100}
                          placeholder="Ej. Bebidas Calientes"
                          value={createCatNombre}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(createCatFieldErrors.nombre)}
                          aria-describedby={
                            createCatFieldErrors.nombre ? 'create-cat-name-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateCatNombre(event.target.value);
                            setCreateCatFieldErrors((prev) => ({ ...prev, nombre: undefined }));
                          }}
                        />
                      </label>
                      {createCatFieldErrors.nombre && (
                        <span id="create-cat-name-error" role="alert" className="admin-field-error">
                          {createCatFieldErrors.nombre}
                        </span>
                      )}
                    </div>

                    <div className="admin-form-field admin-form-field-wide">
                      <label>
                        Descripción de la categoría (opcional)
                        <textarea
                          rows={2}
                          maxLength={500}
                          placeholder="Describe el tipo de productos de esta categoría"
                          value={createCatDescripcion}
                          disabled={isSubmitting}
                          aria-invalid={Boolean(createCatFieldErrors.descripcion)}
                          aria-describedby={
                            createCatFieldErrors.descripcion ? 'create-cat-desc-error' : undefined
                          }
                          onChange={(event) => {
                            setCreateCatDescripcion(event.target.value);
                            setCreateCatFieldErrors((prev) => ({ ...prev, descripcion: undefined }));
                          }}
                        />
                      </label>
                      {createCatFieldErrors.descripcion && (
                        <span id="create-cat-desc-error" role="alert" className="admin-field-error">
                          {createCatFieldErrors.descripcion}
                        </span>
                      )}
                    </div>

                    <div className="admin-form-actions">
                      <button type="submit" className="btn-primary" disabled={isSubmitting}>
                        {isSubmitting ? 'Guardando…' : 'Crear categoría'}
                      </button>
                    </div>
                  </form>
                </section>

                {editingCategory && (
                  <section className="admin-panel-notice" aria-labelledby="edit-category-heading">
                    <h2 id="edit-category-heading">Editar categoría: {editingCategory.nombre}</h2>
                    <form
                      className="admin-form-grid"
                      onSubmit={(event) => void handleEditCategorySubmit(event)}
                      noValidate
                    >
                      <div className="admin-form-field">
                        <label>
                          Nombre al editar categoría
                          <input
                            type="text"
                            maxLength={100}
                            value={editCatNombre}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editCatFieldErrors.nombre)}
                            aria-describedby={
                              editCatFieldErrors.nombre ? 'edit-cat-name-error' : undefined
                            }
                            onChange={(event) => {
                              setEditCatNombre(event.target.value);
                              setEditCatFieldErrors((prev) => ({ ...prev, nombre: undefined }));
                            }}
                          />
                        </label>
                        {editCatFieldErrors.nombre && (
                          <span id="edit-cat-name-error" role="alert" className="admin-field-error">
                            {editCatFieldErrors.nombre}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-field admin-form-field-wide">
                        <label>
                          Descripción al editar categoría
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={editCatDescripcion}
                            disabled={isSubmitting}
                            aria-invalid={Boolean(editCatFieldErrors.descripcion)}
                            aria-describedby={
                              editCatFieldErrors.descripcion ? 'edit-cat-desc-error' : undefined
                            }
                            onChange={(event) => {
                              setEditCatDescripcion(event.target.value);
                              setEditCatFieldErrors((prev) => ({ ...prev, descripcion: undefined }));
                            }}
                          />
                        </label>
                        {editCatFieldErrors.descripcion && (
                          <span id="edit-cat-desc-error" role="alert" className="admin-field-error">
                            {editCatFieldErrors.descripcion}
                          </span>
                        )}
                      </div>

                      <div className="admin-form-actions">
                        <button type="submit" className="btn-primary" disabled={isSubmitting}>
                          {isSubmitting ? 'Actualizando…' : 'Guardar cambios de categoría'}
                        </button>
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          disabled={isSubmitting}
                          onClick={() => setEditingCategory(null)}
                        >
                          Cancelar edición
                        </button>
                      </div>
                    </form>
                  </section>
                )}

                {confirmingCategoryDeactivation && (
                  <section
                    className="admin-panel-notice admin-confirm-box"
                    role="alertdialog"
                    aria-labelledby="confirm-deactivate-category-heading"
                  >
                    <h2 id="confirm-deactivate-category-heading">Confirmar baja lógica de categoría</h2>
                    <p>
                      ¿Confirmas dar de baja la categoría{' '}
                      <strong>{confirmingCategoryDeactivation.nombre}</strong>? Dejará de aparecer en el
                      catálogo público y no permitirá asociar nuevos productos, conservando sus productos
                      inactivos e historial.
                    </p>
                    <div className="admin-form-actions">
                      <button
                        type="button"
                        className="admin-btn-danger"
                        disabled={isSubmitting}
                        onClick={() => void handleConfirmDeactivateCategory()}
                      >
                        {isSubmitting ? 'Procesando…' : 'Confirmar baja de categoría'}
                      </button>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={isSubmitting}
                        onClick={() => setConfirmingCategoryDeactivation(null)}
                      >
                        Cancelar
                      </button>
                    </div>
                  </section>
                )}

                <section className="admin-panel-notice" aria-labelledby="categories-list-heading">
                  <div className="admin-list-header">
                    <div>
                      <h2 id="categories-list-heading">Categorías del catálogo maestro</h2>
                      <p>
                        Total en catálogo: <strong>{pageData.totalElements}</strong>
                      </p>
                    </div>

                    <div className="admin-filters-bar">
                      <label>
                        Buscar categoría
                        <input
                          type="search"
                          placeholder="Filtrar por nombre o descripción"
                          value={categorySearchQuery}
                          onChange={(event) => setCategorySearchQuery(event.target.value)}
                        />
                      </label>

                      <label>
                        Estado de categoría
                        <select
                          value={categoryActivoFilter}
                          onChange={(event) => {
                            setCategoryActivoFilter(event.target.value as 'all' | 'true' | 'false');
                            setCategoryPage(0);
                          }}
                        >
                          <option value="all">Todas (activas e inactivas)</option>
                          <option value="true">Solo activas</option>
                          <option value="false">Solo inactivas</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  {visibleCategories.length === 0 ? (
                    <div className="admin-empty-box" role="status">
                      <p>
                        {hasCategoryFilters
                          ? 'No se encontraron categorías para los filtros aplicados.'
                          : 'Aún no hay categorías registradas en el catálogo maestro.'}
                      </p>
                      {hasCategoryFilters && (
                        <button
                          type="button"
                          className="admin-btn-secondary"
                          onClick={() => {
                            setCategorySearchQuery('');
                            setCategoryActivoFilter('all');
                            setCategoryPage(0);
                          }}
                        >
                          Limpiar filtros
                        </button>
                      )}
                    </div>
                  ) : (
                    <ul className="admin-cafeterias-list">
                      {visibleCategories.map((category) => (
                        <li
                          key={category.categoriaId}
                          className={`admin-cafeteria-row${!category.activa ? ' admin-row-inactive' : ''}`}
                        >
                          <div>
                            <div className="admin-catalog-item-title">
                              <strong>{category.nombre}</strong>
                              <span
                                className={`admin-status-pill ${
                                  category.activa ? 'admin-status-active' : 'admin-status-inactive'
                                }`}
                              >
                                {category.activa ? 'Activa' : 'Inactiva'}
                              </span>
                              <span className="admin-version-tag">v{category.version}</span>
                            </div>
                            {category.descripcion && (
                              <p className="admin-catalog-description">{category.descripcion}</p>
                            )}
                            {!category.activa && (
                              <p className="admin-inactive-effect">
                                Oculta en la venta pública y bloqueada para nuevos productos; conserva
                                historial.
                              </p>
                            )}
                          </div>

                          <div className="admin-form-actions">
                            <button
                              type="button"
                              className="admin-btn-secondary"
                              disabled={isSubmitting}
                              onClick={() => startEditCategory(category)}
                            >
                              Editar
                            </button>
                            {category.activa ? (
                              <button
                                type="button"
                                className="admin-btn-danger"
                                disabled={isSubmitting}
                                onClick={() => {
                                  setConfirmingCategoryDeactivation(category);
                                  setEditingCategory(null);
                                  setCategoryInUseConflict(null);
                                  setFormError('');
                                  setFeedbackMessage('');
                                }}
                              >
                                Dar de baja
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={isSubmitting}
                                onClick={() => void handleReactivateCategory(category)}
                              >
                                Reactivar
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {pageData.totalPages > 1 && (
                    <nav className="admin-pagination" aria-label="Paginación de categorías">
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={pageData.first}
                        onClick={() => setCategoryPage((current) => Math.max(0, current - 1))}
                      >
                        Anterior
                      </button>
                      <span>
                        Página {pageData.number + 1} de {pageData.totalPages}
                      </span>
                      <button
                        type="button"
                        className="admin-btn-secondary"
                        disabled={pageData.last}
                        onClick={() => setCategoryPage((current) => current + 1)}
                      >
                        Siguiente
                      </button>
                    </nav>
                  )}
                </section>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
